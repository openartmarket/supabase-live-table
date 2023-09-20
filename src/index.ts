import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

type ID = string | number;
type Row = Record<string, unknown> & { id: ID };

export type LiveTableCallback<TableRow> = (err: Error | undefined, records: readonly TableRow[]) => void;

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
  const liveTable = new LiveTable<TableRow>();

  const { tableName, columnName, columnValue, channelName, callback } = params;

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
      }
    )
    .subscribe();

  // @ts-ignore
  channel.on('system', {}, (payload) => {
    // console.log('system', payload)
    supabase.from(tableName)
      .select("*")
      .eq(columnName, columnValue)
      .then(({error, data}) => {
        if (error) {
          callback(new Error(error.message), []);
        } else {
          liveTable.initial(data)
          callback(undefined, liveTable.records);
        }
      })
  })

  return channel;
}

export class LiveTable<TableRow extends Row> {
  private readonly recordById = new Map<ID, TableRow>();

  initial(records: readonly TableRow[]) {
    for (const record of records) {
      // console.log('initial', this.p(record))
      this.recordById.set(record.id, record);
    }
  }

  inserted(record: TableRow) {
    // console.log('inserted', this.p(record))
    this.recordById.set(record.id, record);
  }

  updated(record: TableRow) {
    // console.log('updated', this.p(record))
    this.recordById.set(record.id, record);
  }

  deleted(record: Partial<TableRow>) {
    // console.log('deleted', this.p(record))
    const id = record.id;
    if (!id) {
      throw new Error(`deleted record has no id`)
    }
    this.recordById.delete(id);
  }

  get records(): readonly TableRow[] {
    return [...this.recordById.values()];
  }

  p({id, type, name}: Partial<TableRow>) {
    return {id, type, name} 
  }
}
