import { describe, it, beforeEach, expect } from 'vitest';
import { liveTable } from '../src';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from './Database';

type ThingRow = Database['public']['Tables']['thing']['Row'];

describe('liveTable', () => {
  const supabase = new SupabaseClient<Database>(
    'http://localhost:50321',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    {
      auth: {
        persistSession: false,
      },
    },
  );

  beforeEach(async () => {
    await supabase.from('thing').delete().neq('type', '').throwOnError();
  });

  it('shows an example of usage for the README', async () => {
    function subscribe(handleThings: (things: readonly ThingRow[]) => void) {
      const channel = liveTable<ThingRow>(supabase, {
        table: 'thing',
        filterColumn: 'type',
        filterValue: 'vehicle',
        callback: (err, things) => {
          if (err) {
            channel.unsubscribe().then(() => subscribe(handleThings));
            return;
          }
          handleThings(things);
        },
      });
      return channel;
    }

    const channel = subscribe((things) => {
      console.log('Updated things:', things);
    });

    channel.unsubscribe();
  });

  it('filters on column', async () => {
    await waitForReplicaToMatch({
      filterValue: 'vehicle',
      writeAfterSubscribed: async () => {
        await supabase
          .from('thing')
          .insert([
            { type: 'ignored', name: 'skateboard', color: 'green' },
            { type: 'vehicle', name: 'bicycle', color: 'blue' },
            { type: 'ignored', name: 'zeppelin', color: 'black' },
          ])
          .throwOnError();
      },
      expectedSortedRecordNames: ['bicycle'],
    });
  });

  it('handles inserts', async () => {
    await waitForReplicaToMatch({
      filterValue: 'vehicle',
      writeAfterSubscribed: async () => {
        await supabase
          .from('thing')
          .insert({ type: 'vehicle', name: 'skateboard', color: 'blue' })
          .throwOnError();
      },
      expectedSortedRecordNames: ['skateboard'],
    });
  });

  it('handles deletes', async () => {
    await waitForReplicaToMatch({
      filterValue: 'vehicle',
      writeAfterSubscribed: async () => {
        await supabase
          .from('thing')
          .insert([
            { type: 'vehicle', name: 'skateboard', color: 'green' },
            { type: 'vehicle', name: 'bicycle', color: 'blue' },
            { type: 'vehicle', name: 'zeppelin', color: 'black' },
          ])
          .select()
          .throwOnError();
        await supabase.from('thing').delete().eq('name', 'bicycle').throwOnError();
      },
      expectedSortedRecordNames: ['skateboard', 'zeppelin'],
    });
  });

  it('handles updates', async () => {
    await waitForReplicaToMatch({
      filterValue: 'vehicle',
      writeAfterSubscribed: async () => {
        await supabase
          .from('thing')
          .insert([
            { type: 'vehicle', name: 'skateboard', color: 'green' },
            { type: 'vehicle', name: 'bicycle', color: 'blue' },
            { type: 'vehicle', name: 'zeppelin', color: 'black' },
          ])
          .throwOnError();
        await supabase.from('thing').update({ name: 'bike' }).eq('name', 'bicycle').throwOnError();
      },
      expectedSortedRecordNames: ['bike', 'skateboard', 'zeppelin'],
    });
  });

  type Params = {
    filterValue: string;
    writeAfterSubscribed: () => Promise<void>;
    expectedSortedRecordNames: readonly string[];
  };

  async function waitForReplicaToMatch({
    filterValue,
    writeAfterSubscribed,
    expectedSortedRecordNames,
  }: Params): Promise<void> {
    let error: Error | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const success = new Promise<void>((resolve, reject) => {
      let firstCallback = true;
      const channel = liveTable<ThingRow>(supabase, {
        table: 'thing',
        filterColumn: 'type',
        filterValue,
        callback: (err, records) => {
          if (err) return reject(err);
          if (firstCallback) {
            writeAfterSubscribed().catch(reject);
            firstCallback = false;
          }

          const names = [...records].map((r) => r.name).sort();
          try {
            expect(names).toEqual(expectedSortedRecordNames);
            channel
              .unsubscribe()
              .then(() => {
                clearTimeout(timer);
                resolve();
              })
              .catch(reject);
          } catch (err) {
            error = err as Error;
          }
        },
      });
    });

    const timeout = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(error || new Error('No messages(?!)')), 3000);
    });

    await Promise.race([success, timeout]);
  }
});
