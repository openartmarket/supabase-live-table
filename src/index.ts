import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

type ID = string | number;
export type Row = Record<string, unknown> & { id: ID };

export type LiveTableCallback<TableRow> = (
  err: Error | undefined,
  records: readonly TableRow[],
) => void;

export type LiveTableParams<
  TableRow,
  ColumnName extends keyof TableRow & string,
> = {
  table: string;
  filterColumn: ColumnName;
  filterValue: TableRow[ColumnName];
  channelName: string;
  callback: LiveTableCallback<TableRow>;
};

// https://github.com/GaryAustin1/Realtime2
// https://github.com/orgs/supabase/discussions/5641
export function liveTable<
  TableRow extends Row,
  ColumnName extends keyof TableRow & string,
>(
  supabase: SupabaseClient,
  params: LiveTableParams<TableRow, ColumnName>,
): RealtimeChannel {
  const liveTable = new LiveTable<TableRow>();

  const {
    table: tableName,
    filterColumn: columnName,
    filterValue: columnValue,
    channelName,
    callback,
  } = params;

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
      (payload: RealtimePostgresChangesPayload<TableRow>) => {
        // const timestamp = new Date(payload.commit_timestamp);
        // console.log('timestamp', timestamp)
        // TODO, pass the timestamp to inserted
        // Maybe simply libeTable.handleEvent({ timestamp, type, record})
        switch (payload.eventType) {
          case "INSERT": {
            liveTable.inserted(payload.new);
            break;
          }
          case "UPDATE": {
            liveTable.updated(payload.new);
            break;
          }
          case "DELETE": {
            liveTable.deleted(payload.old);
            break;
          }
        }
        callback(undefined, liveTable.records);
      },
    )
    .subscribe((status) => {
      // console.log("SUBSCRIPTION: " + status);
      const ERROR_STATES: `${REALTIME_SUBSCRIBE_STATES}`[] = [
        REALTIME_SUBSCRIBE_STATES.TIMED_OUT,
        REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
      ];
      if (ERROR_STATES.includes(status)) {
        callback(new Error("SUBSCRIPTION: " + status), []);
      }
    });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  channel.on("system", {}, (payload) => {
    // console.log('system', payload)
    if (payload.extension === "postgres_changes") {
      supabase
        .from(tableName)
        .select("*")
        .eq(columnName, columnValue)
        .then(({ error, data }) => {
          if (error) {
            callback(new Error(error.message), []);
          } else {
            liveTable.initial(data);
            callback(undefined, liveTable.records);
          }
        });
    }
  });

  return channel;
}

type BufferedInsert<TableRow> = {
  type: "inserted";
  record: TableRow;
};

type BufferedUpdate<TableRow> = {
  type: "updated";
  record: TableRow;
};

type BufferedDelete<TableRow> = {
  type: "deleted";
  record: Partial<TableRow>;
};

type BufferedRecord<TableRow> =
  | BufferedInsert<TableRow>
  | BufferedUpdate<TableRow>
  | BufferedDelete<TableRow>;

export type ILiveTable<TableRow extends Row> = {
  initial(records: readonly TableRow[]): void;
  inserted(record: TableRow): void;
  updated(record: TableRow): void;
  deleted(record: Partial<TableRow>): void;
  readonly records: readonly TableRow[];
};

export class LiveTable<TableRow extends Row> implements ILiveTable<TableRow> {
  private readonly recordById = new Map<ID, TableRow>();
  private initialized = false;
  private readonly buffer: BufferedRecord<TableRow>[] = [];

  initial(records: readonly TableRow[]) {
    for (const record of records) {
      this.recordById.set(record.id, record);
    }
    this.initialized = true;
    for (const buffered of this.buffer) {
      switch (buffered.type) {
        case "inserted": {
          this.inserted(buffered.record);
          break;
        }
        case "updated": {
          this.updated(buffered.record);
          break;
        }
        case "deleted": {
          this.deleted(buffered.record);
          break;
        }
      }
    }
  }

  inserted(record: TableRow) {
    if (!this.initialized) {
      this.buffer.push({ type: "inserted", record });
      return;
    }
    this.recordById.set(record.id, record);
  }

  updated(record: TableRow) {
    if (!this.initialized) {
      this.buffer.push({ type: "updated", record });
      return;
    }
    this.recordById.set(record.id, record);
  }

  deleted(record: Partial<TableRow>) {
    const id = record.id;
    if (!id) {
      throw new Error(`deleted record has no id`);
    }
    if (!this.initialized) {
      this.buffer.push({ type: "deleted", record });
      return;
    }
    this.recordById.delete(id);
  }

  get records(): readonly TableRow[] {
    return [...this.recordById.values()];
  }
}
