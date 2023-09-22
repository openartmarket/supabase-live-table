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
    // Create a promise that resolves when we've seen the expected records
    const p = new Promise<void>((resolve, reject) => {
      // Start a table replication
      const channel = liveTable<ThingRow, 'type'>(supabase, {
        // The table to replicate
        table: 'thing',
        // The column to filter on. It's strongly recommended to have an index on this column.
        filterColumn: 'type',
        // The value to filter on
        filterValue: 'vehicle',
        // The name of the channel to subscribe to
        channelName: 'thing:vehicle',
        // This callback is called for every change to the table
        callback: (err, records) => {
          if (err) return reject(err);
          // Check that we've seen the expected records, which is just one record with name 'bike' and type 'vehicle'
          const actual = records.map(({ type, name }) => ({ type, name })).sort();
          const expected = [{ type: 'vehicle', name: 'bike' }];
          if (JSON.stringify(actual) == JSON.stringify(expected.sort())) {
            channel
              .unsubscribe()
              .then(() => resolve())
              .catch(reject);
          }
        },
      });
    });
    // Insert some records, one of which matches our filter
    await supabase
      .from('thing')
      .insert([
        { type: 'ignored', name: 'skateboard' },
        { type: 'vehicle', name: 'bicycle' },
        { type: 'ignored', name: 'zeppelin' },
      ])
      .throwOnError();
    // Rename bicycle to bike
    await supabase.from('thing').update({ name: 'bike' }).eq('name', 'bicycle').throwOnError();
    // Wait until we've seen the expected records
    await p;
  });

  it('filters on column', async () => {
    await hasRecords('vehicle', ['bicycle'], async () => {
      await supabase
        .from('thing')
        .insert([
          { type: 'ignored', name: 'skateboard' },
          { type: 'vehicle', name: 'bicycle' },
          { type: 'ignored', name: 'zeppelin' },
        ])
        .throwOnError();
    });
  });

  it('handles inserts', async () => {
    await hasRecords('vehicle', ['skateboard'], async () => {
      await supabase.from('thing').insert({ type: 'vehicle', name: 'skateboard' }).throwOnError();
    });
  });

  it('handles deletes', async () => {
    await hasRecords('vehicle', ['skateboard', 'zeppelin'], async () => {
      await supabase
        .from('thing')
        .insert([
          { type: 'vehicle', name: 'skateboard' },
          { type: 'vehicle', name: 'bicycle' },
          { type: 'vehicle', name: 'zeppelin' },
        ])
        .select()
        .throwOnError();
      await supabase.from('thing').delete().eq('name', 'bicycle').throwOnError();
    });
  });

  it('handles updates', async () => {
    await hasRecords('vehicle', ['bike', 'skateboard', 'zeppelin'], async () => {
      await supabase
        .from('thing')
        .insert([
          { type: 'vehicle', name: 'skateboard' },
          { type: 'vehicle', name: 'bicycle' },
          { type: 'vehicle', name: 'zeppelin' },
        ])
        .throwOnError();
      await supabase.from('thing').update({ name: 'bike' }).eq('name', 'bicycle').throwOnError();
    });
  });

  it('handles updates that arrive after snapshot', async () => {
    await hasRecords(
      'vehicle',
      ['bike', 'skateboard', 'zeppelin'],
      async () => {
        await supabase
          .from('thing')
          .insert([
            { type: 'vehicle', name: 'skateboard' },
            { type: 'vehicle', name: 'bicycle' },
            { type: 'vehicle', name: 'zeppelin' },
          ])
          .throwOnError();
      },
      async () => {
        await supabase.from('thing').update({ name: 'bike' }).eq('name', 'bicycle').throwOnError();
      },
    );
  });
  async function hasRecords(
    columnValue: string,
    expected: readonly string[],
    write: () => Promise<void>,
    subscribed?: () => Promise<void>,
  ): Promise<void> {
    let error: Error | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const success = new Promise<void>((resolve, reject) => {
      const channel = liveTable<ThingRow, 'type'>(supabase, {
        table: 'thing',
        filterColumn: 'type',
        filterValue: columnValue,
        channelName: 'thing:vehicle',
        callback: (err, records) => {
          if (err) return reject(err);
          const names = [...records].map((r) => r.name).sort();
          try {
            expect(names).toEqual(expected);
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
      timer = setTimeout(() => reject(error || new Error('No messages(?!)')), 1000);
    });

    await Promise.race([success, timeout]);
  }
});
