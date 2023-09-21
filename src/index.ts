import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';

type ID = string | number;
export type Row = Record<string, unknown> & { id: ID };

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

// https://github.com/GaryAustin1/Realtime2
// https://github.com/orgs/supabase/discussions/5641
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
          // const timestamp = new Date(payload.commit_timestamp);
          // console.log('timestamp', timestamp)
          // TODO, pass the timestamp to inserted
          // Maybe simply libeTable.handleEvent({ timestamp, type, record})
          switch (payload.eventType) {
            case 'INSERT': {
              liveTable.processEvent({ type: 'INSERT', record: payload.new });
              break;
            }
            case 'UPDATE': {
              liveTable.processEvent({ type: 'UPDATE', record: payload.new });
              break;
            }
            case 'DELETE': {
              liveTable.processEvent({ type: 'DELETE', record: payload.old });
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
          callback(new Error('SUBSCRIPTION: ' + status), []);
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
};

type Update<TableRow> = {
  type: 'UPDATE';
  record: TableRow;
};

type Delete<TableRow> = {
  type: 'DELETE';
  record: Partial<TableRow>;
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
    for (const record of records) {
      this.recordById.set(record.id, record);
    }
    this.buffering = false;
    for (const event of this.bufferedEvents) {
      this.processEvent(event);
    }
  }

  get records(): readonly TableRow[] {
    return [...this.recordById.values()];
  }
}
