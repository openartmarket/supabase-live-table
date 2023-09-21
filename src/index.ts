import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';

type ID = string | number;
export type Row = Record<string, unknown> & {
  id: ID;
  created_at: string;
  updated_at: string | null;
};

export type LiveTableCallback<TableRow> = (
  err: Error | undefined,
  records: readonly TableRow[],
) => void;

export type LiveTableParams<TableRow, ColumnName extends keyof TableRow & string> = {
  table: string;
  filterColumn: ColumnName;
  filterValue: TableRow[ColumnName];
  channelName: string;
  callback: LiveTableCallback<TableRow>;
};

export function liveTable<TableRow extends Row, ColumnName extends keyof TableRow & string>(
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

  return (
    supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: `${columnName}=eq.${columnValue}`,
        },
        (payload: RealtimePostgresChangesPayload<TableRow>) => {
          const timestamp = new Date(payload.commit_timestamp);
          switch (payload.eventType) {
            case 'INSERT': {
              liveTable.processEvent({ type: 'INSERT', record: payload.new, timestamp });
              break;
            }
            case 'UPDATE': {
              liveTable.processEvent({ type: 'UPDATE', record: payload.new, timestamp });
              break;
            }
            case 'DELETE': {
              liveTable.processEvent({ type: 'DELETE', record: payload.old, timestamp });
              break;
            }
          }
          callback(undefined, liveTable.records);
        },
      )
      .subscribe((status) => {
        const ERROR_STATES: `${REALTIME_SUBSCRIBE_STATES}`[] = [
          REALTIME_SUBSCRIBE_STATES.TIMED_OUT,
          REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
        ];
        if (ERROR_STATES.includes(status)) {
          callback(new Error(`SUBSCRIPTION: ${status}`), []);
        }
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      .on('system', {}, (payload) => {
        if (payload.extension === 'postgres_changes') {
          supabase
            .from(tableName)
            .select('*')
            .eq(columnName, columnValue)
            .then(({ error, data }) => {
              if (error) {
                callback(new Error(error.message), []);
              } else {
                liveTable.snapshot(data);
                callback(undefined, liveTable.records);
              }
            });
        }
      })
  );
}

type Insert<TableRow> = {
  type: 'INSERT';
  record: TableRow;
  timestamp: Date;
};

type Update<TableRow> = {
  type: 'UPDATE';
  record: TableRow;
  timestamp: Date;
};

type Delete<TableRow> = {
  type: 'DELETE';
  record: Partial<TableRow>;
  timestamp: Date;
};

export type LiveTableEvent<TableRow> = Insert<TableRow> | Update<TableRow> | Delete<TableRow>;

export type ILiveTable<TableRow extends Row> = {
  snapshot(records: readonly TableRow[]): void;
  processEvent(event: LiveTableEvent<TableRow>): void;
  readonly records: readonly TableRow[];
};

export class LiveTable<TableRow extends Row> implements ILiveTable<TableRow> {
  private readonly recordById = new Map<ID, TableRow>();
  private buffering = true;
  private readonly bufferedEvents: LiveTableEvent<TableRow>[] = [];

  public processEvent(event: LiveTableEvent<TableRow>) {
    if (this.buffering) {
      this.bufferedEvents.push(event);
      return;
    }

    const { type, record } = event;
    switch (type) {
      case 'INSERT': {
        this.recordById.set(record.id, record);
        break;
      }
      case 'UPDATE': {
        this.recordById.set(record.id, record);
        break;
      }
      case 'DELETE': {
        const id = record.id;
        if (!id) {
          throw new Error(`Cannot delete. Record has no id: ${JSON.stringify(record)}`);
        }
        this.recordById.delete(id);
        break;
      }
    }
  }

  snapshot(records: readonly TableRow[]) {
    let snapshotTimestamp = new Date(0);
    for (const record of records) {
      const ts = new Date(record.updated_at || record.created_at);
      if (ts > snapshotTimestamp) {
        snapshotTimestamp = ts;
      }
      this.recordById.set(record.id, record);
    }
    this.buffering = false;
    for (const event of this.bufferedEvents) {
      if (event.timestamp < snapshotTimestamp) {
        // This event is older than the snapshot, so we can ignore it
        continue;
      }
      this.processEvent(event);
    }
  }

  get records(): readonly TableRow[] {
    return [...this.recordById.values()];
  }
}
