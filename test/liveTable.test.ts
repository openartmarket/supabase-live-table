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
    await waitForReplicatToMatch({
      filterValue: 'vehicle',
      expectedSortedRecordNames: ['bicycle'],
      write: async () => {
        await supabase
          .from('thing')
          .insert([
            { type: 'ignored', name: 'skateboard', color: 'green' },
            { type: 'vehicle', name: 'bicycle', color: 'blue' },
            { type: 'ignored', name: 'zeppelin', color: 'black' },
          ])
          .throwOnError();
      },
    });
  });

  it('handles inserts', async () => {
    await waitForReplicatToMatch({
      filterValue: 'vehicle',
      expectedSortedRecordNames: ['skateboard'],
      write: async () => {
        await supabase
          .from('thing')
          .insert({ type: 'vehicle', name: 'skateboard', color: 'blue' })
          .throwOnError();
      },
    });
  });

  it('handles deletes', async () => {
    await waitForReplicatToMatch({
      filterValue: 'vehicle',
      expectedSortedRecordNames: ['skateboard', 'zeppelin'],
      write: async () => {
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
    });
  });

  it('handles updates', async () => {
    await waitForReplicatToMatch({
      filterValue: 'vehicle',
      expectedSortedRecordNames: ['bike', 'skateboard', 'zeppelin'],
      write: async () => {
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
    });
  });

  it('handles updates that arrive after snapshot', async () => {
    await waitForReplicatToMatch({
      filterValue: 'vehicle',
      expectedSortedRecordNames: ['bike', 'skateboard', 'zeppelin'],
      write: async () => {
        await supabase
          .from('thing')
          .insert([
            { type: 'vehicle', name: 'skateboard', color: 'green' },
            { type: 'vehicle', name: 'bicycle', color: 'blue' },
            { type: 'vehicle', name: 'zeppelin', color: 'black' },
          ])
          .throwOnError();
      },
      subscribed: async () => {
        await supabase.from('thing').update({ name: 'bike' }).eq('name', 'bicycle').throwOnError();
      },
    });
  });

  type Params = {
    filterValue: string;
    expectedSortedRecordNames: readonly string[];
    write: () => Promise<void>;
    subscribed?: () => Promise<void>;
  };

  async function waitForReplicatToMatch({
    filterValue,
    expectedSortedRecordNames,
    write,
    subscribed,
  }: Params): Promise<void> {
    let error: Error | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const success = new Promise<void>((resolve, reject) => {
      const channel = liveTable<ThingRow>(supabase, {
        table: 'thing',
        filterColumn: 'type',
        filterValue,
        callback: (err, records) => {
          if (err) return reject(err);
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
          if (subscribed) {
            subscribed().catch(reject);
          }
        },
      });
      write().catch(reject);
    });

    const timeout = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(error || new Error('No messages(?!)')), 3000);
    });

    await Promise.race([success, timeout]);
  }
});
