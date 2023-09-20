import type {
  PostgrestError,
  PostgrestResponse,
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

export type LiveParams<TableRow> = {
  /**
   * Compare two records for equality
   * @param a
   * @param b
   * @returns true if they are the same record
   */
  same: (a: TableRow, b: TableRow) => boolean;
  /**
   * Error callback
   * @param error
   */
  err?: (error: PostgrestError) => void;
  /**
   * Called with the initial data. Always called before the other callbacks
   * @param rows
   */
  initial?: (rows: readonly TableRow[]) => void;
  /**
   * Called when a new (nu) row is inserted
   * @param nu
   */
  inserted?: (nu: TableRow) => void;
  /**
   * Called when a row is updated
   * @param old
   * @param nu
   */
  updated?: (old: Partial<TableRow>, nu: TableRow) => void;
  /**
   * Called when a row is deleted
   * @param old
   * @param nu
   */
  deleted?: (old: Partial<TableRow>) => void;
};

type ID = string | number;
type Row = Record<string, unknown> & { id: ID };

export type SelectCallback<TableRow> = (res: PostgrestResponse<TableRow>) => void;
export type RealtimeCallback<TableRow extends Row> = (payload: RealtimePostgresChangesPayload<TableRow>) => void;

export type LiveCallbacks<TableRow extends Row> = {
  selectCallback: SelectCallback<TableRow>;
  realtimeCallback: RealtimeCallback<TableRow>;
};

/**
 * Creates two callbacks - selectCallback and realtimeCallback.
 *
 * Use these for select query as well as a realtime subscription. Both should have consistent filters.
 *
 * This allows the client to build a live, in-memory representation of the (filtered) data in the database.
 *
 * @param params subscription params
 * @returns {@type RealtimeChannel}
 */
export function liveCallbacks<TableRow extends Row>(params: LiveParams<TableRow>): LiveCallbacks<TableRow> {
  const { same, err, initial, inserted: insert, updated: update, deleted: del } = params;

  let initialRecords: TableRow[] | undefined = undefined;
  const bufferedPayloads: RealtimePostgresChangesPayload<TableRow>[] = [];

  const selectCallback = (res: PostgrestResponse<TableRow>) => {
    if (res.error) {
      err && err(res.error);
      return;
    }
    initialRecords = res.data;

    initial && initial(initialRecords);

    for (const payload of bufferedPayloads) {
      console.log("processing buffered payload", payload);
      processPayload(payload, initialRecords);
    }
  };

  const realtimeCallback = (payload: RealtimePostgresChangesPayload<TableRow>) => {
    if (initialRecords === undefined) {
      bufferedPayloads.push(payload);
      return;
    }
    processPayload(payload, initialRecords);
  };

  function processPayload(payload: RealtimePostgresChangesPayload<TableRow>, initialRows: TableRow[]) {
    switch (payload.eventType) {
      case "INSERT": {
        const isInitial = initialRows.find((initialRow) => same(initialRow, payload.new));
        if (!isInitial) {
          insert && insert(payload.new);
        }
        break;
      }
      case "UPDATE": {
        update && update(payload.old, payload.new);
        break;
      }
      case "DELETE": {
        del && del(payload.old);
        break;
      }
    }
  }

  return {
    selectCallback,
    realtimeCallback,
  };
}

export type LiveTableCallback<TableRow> = (err: Error | undefined, records: IterableIterator<TableRow>) => void;

export type LiveTableParams<TableRow, ColumnName extends keyof TableRow & string> = {
  tableName: string;
  columnName: ColumnName;
  columnValue: TableRow[ColumnName];
  channelName: string;
  callback: LiveTableCallback<TableRow>;
};

// https://github.com/GaryAustin1/Realtime2
// https://github.com/orgs/supabase/discussions/5641
export function liveTable<TableRow extends Row, ColumnName extends keyof TableRow & string>(
  supabase: SupabaseClient,
  params: LiveTableParams<TableRow, ColumnName>
): RealtimeChannel {
  const { tableName, columnName, columnValue, channelName, callback } = params;
  const recordById = new Map<ID, TableRow>();

  function emit(err?: Error) {
    const records = recordById.values();
    callback(err, records);
  }

  const { selectCallback, realtimeCallback } = liveCallbacks<TableRow>({
    same(a, b) {
      return a.id === b.id;
    },
    initial(records) {
      for (const record of records) {
        recordById.set(record.id, record);
      }
      emit();
    },
    inserted(newRecord) {
      recordById.set(newRecord.id, newRecord);
      emit();
    },
    updated(_, newRecord) {
      recordById.set(newRecord.id, newRecord);
      emit();
    },
    deleted(deletedRecord) {
      const id = deletedRecord.id;
      if (!id) {
        emit(new Error(`deleted record has no id`));
        return;
      }
      recordById.delete(id);
      emit();
    },
    err(error) {
      emit(new Error(error.message));
    },
  });

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: tableName,
        filter: `${columnName}=eq.${columnValue}`,
      },
      realtimeCallback
    )
    .subscribe();

  // channel.on('system', {}, (payload) => {
  //   console.log('system', payload);
  // })

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  supabase.from(tableName)
    .select("*")
    .eq(columnName, columnValue)
    .then(selectCallback, err => emit(err))
  return channel;
}
