# Supabase Live Table

In-memory replication of a Postgres table, synchronized with [Supabase Realtime](https://supabase.com/docs/guides/realtime).

## Motivation

At [Open Art Market](https://openartmarket.com) we provide a marketplace where people can buy and sell shares in physical artworks.

All buy/sell orders are stored in Supabase, and we needed a reliable way to display the current state of the order book in real-time.

Supabase Realtime provides low-level primitives for receiving notifications of changes to a table, but it does not provide a way to keep a replica of the table in memory. This library provides a way to do that.

## Overview

Supabase Live Table provides one function (`liveTable`) that replicates a Postgres table in memory, and keeps it up to date with changes to the table in real-time. It uses [Supabase Realtime](https://supabase.com/docs/guides/realtime) to receive notifications of changes to the table, and then updates its in-memory read only replica.

The rows to replicate can be filtered by a column value.

## Installation

    npm install @openartmarket/supabase-live-table

## Table configuration

LiveTable requires a few changes to your database table to work correctly.

### 1. Required columns

The replicated table must have the following columns:

* `id` - a primary key column that maps to a JavaScript `number` or `string` (e.g. `bigint` or `uuid`)
* `created_at` - a timestamp column with a default value of `now()`
* `updated_at` - a timestamp column that is updated automatically when a row is updated (more about this below)
* An arbitrary *filter column* of your choice to filter what rows to replicate. It's strongly recommended to have an index on this column.

In addition to these required columns, you can have any other columns you like.

For example:

```sql
create table "thing" (
  "id" uuid primary key default uuid_generate_v4(),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone,
  -- our filter column
  "type" text not null,
  "name" text not null
);
```

### 2. Update updated_at automatically

The `updated_at` column must be updated automatically when a row is updated. This can be done with a trigger:

```sql
create extension if not exists "moddatetime" with schema "extensions";
create trigger handle_updated_at before update on "thing"
  for each row execute procedure moddatetime (updated_at);
```

The `created_at` and `updated_at` columns are used to determine whether or not to apply a change to the in-memory replica.

### 3. Enable realtime

Make sure the replicated table has `supabase_realtime` publication enabled:

```sql 
drop publication if exists supabase_realtime; 
create publication supabase_realtime; 
-- Specify the table you're enabling realtime for 
alter publication supabase_realtime add table "thing";
```

## Usage

After configuring your table, you can use the `liveTable` function to replicate it in memory.

The example below shows how to replicate a table called `thing` with a filter column called `type`.
This example unsubscribes from the realtime channel once it has seen the expected records.

```typescript
import { liveTable } from '@openartmarket/supabase-live-table'
import { SupabaseClient } from '@supabase/supabase-js'
// From `supabase gen types typescript --local > test/Database.ts`
import { Database } from './Database'

type ThingRow = Database['public']['Tables']['thing']['Row']


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
    // This callback is called for every change to the table, or if an error occurs
    callback: (err, records) => {
      if (err) return reject(err)
      // Check that we've seen the expected records, which is just one record with name 'bike' and type 'vehicle'
      const actual = records.map(({ type, name }) => ({ type, name })).sort()
      const expected = [{ type: 'vehicle', name: 'bike' }]
      if (JSON.stringify(actual) == JSON.stringify(expected.sort())) {
        channel.unsubscribe().then(() => resolve()).catch(reject)
      }
    }
  })
})
// Insert some records, one of which matches our filter
await supabase.from('thing').insert([
  { type: 'ignored', name: 'skateboard' },
  { type: 'vehicle', name: 'bicycle' },
  { type: 'ignored', name: 'zeppelin' },
]).throwOnError()
// Rename bicycle to bike
await supabase.from('thing').update({ name: 'bike' }).eq('name', 'bicycle').throwOnError()
// Wait until we've seen the expected records
await p

```

## Implementation

The [Change Data Capture](https://en.wikipedia.org/wiki/Change_data_capture) algorithm is based on
an algorithm often used in trading systems that subscribe to market data feeds.

Market data feeds typically have two different APIs - one for requesting a snapshot of the current state of the market, and another for receiving incremental updates to the market data in real-time.

In LiveTable, the snapshot is simply a `SELECT` query, and the incremental updates are the Supabase Realtime messages.
The algoritm is as follows:

1. Subscribe to the Supabase Realtime channel for the table.
2. Add incoming Realtime messages to an in-memory FIFO queue.
3. Request a snapshot (`SELECT`) once the Realtime channel is active.
4. Apply snapshot data to the in-memory replica.
5. Process queued Realtime messages that were received while waiting for the snapshot. Skip messages that are older than the snapshot.
6. Update the in-memory replica for every new Realtime message.

### Errors

If the Realtime channel is disconnected as result of a timeout or network error, the `callback` function will be called with an error.

### ⚠️⚠️⚠️ Reconnection is out of scope ⚠️⚠️⚠️ 

Automatic reconnection is out of scope of this library and must be implemented by the caller - typically when the `callback` function is called with an error.

## Testing

There are two test suites for this library:

* [test/liveTable.test.ts](test/liveTable.test.ts) integration test for the `liveTable` function.
* [test/liveTableBuffering.test.ts](test/liveTableBuffering.test.ts) unit tests for concurrency.

It's not possible to reliably test the concurrency of the `liveTable` function, so the unit tests are a best effort attempt to test the concurrency of the buffering algorithm.

The unit tests simulate various concurrency scenarios by interacting directly with the internal `LiveTable` class.
These tests also generate [sequence diagrams](/docs/sequence-diagrams/) that show the order of events for each scenario, as well as the final state of the in-memory replica.

Documenting a system like this is called [living documentation](https://www.amazon.co.uk/Living-Documentation-Cyrille-Martraire/dp/0134689321) and is a great way to keep the documentation up to date.

## License

MIT © [Open Art Market](https://openartmarket.com)
