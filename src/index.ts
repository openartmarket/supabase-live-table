import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';

type ID = string | number;
export type LiveRow = Record<string, unknown> & {
  id: ID;
  created_at: string;
  updated_at: string | null;
};

export type LiveTableCallback<TableRow extends LiveRow> = (
  err: Error | undefined,
  records: readonly TableRow[],
) => void;

export type LiveTableParams<
  TableRow extends LiveRow,
  ColumnName extends keyof TableRow & string,
> = {
  table: string;
  filterColumn: ColumnName;
  filterValue: TableRow[ColumnName];
  callback: LiveTableCallback<TableRow>;
  schema?: string;
  channelName?: string;
};

export function liveTable<TableRow extends LiveRow>(
  supabase: SupabaseClient,
  params: LiveTableParams<TableRow, keyof TableRow & string>,
): RealtimeChannel {
  const parseTimestamp = (timestamp: string) => new Date(timestamp).getTime();
  const liveTable = new LiveTable<TableRow>(parseTimestamp);

  const {
    table,
    filterColumn,
    filterValue,
    callback,
    channelName = `${table}-${filterColumn}-${filterValue}`,
    schema = 'public',
  } = params;

  return (
    supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema,
          table,
          filter: `${filterColumn}=eq.${filterValue}`,
        },
        (payload: RealtimePostgresChangesPayload<TableRow>) => {
          const timestamp = payload.commit_timestamp;
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
            .from(table)
            .select('*')
            .eq(filterColumn, filterValue)
            .then(({ error, data }) => {
              if (error) {
                callback(new Error(error.message), []);
              } else {
                liveTable.processSnapshot(data);
                callback(undefined, liveTable.records);
              }
            });
        }
      })
  );
}

type Insert<TableRow extends LiveRow> = {
  type: 'INSERT';
  record: TableRow;
  timestamp: string;
};

type Update<TableRow extends LiveRow> = {
  type: 'UPDATE';
  record: TableRow;
  timestamp: string;
};

type Delete<TableRow extends LiveRow> = {
  type: 'DELETE';
  record: Partial<TableRow>;
  timestamp: string;
};

export type LiveTableEvent<TableRow extends LiveRow> =
  | Insert<TableRow>
  | Update<TableRow>
  | Delete<TableRow>;

export type ILiveTable<TableRow extends LiveRow> = {
  processSnapshot(records: readonly TableRow[]): void;
  processEvent(event: LiveTableEvent<TableRow>): void;
  readonly records: readonly TableRow[];
};

export type ParseTimestamp = (timestamp: string) => number;

export class LiveTable<TableRow extends LiveRow> implements ILiveTable<TableRow> {
  private readonly recordById = new Map<ID, TableRow>();
  private buffering = true;
  private readonly bufferedEvents: LiveTableEvent<TableRow>[] = [];

  constructor(private readonly parseTimestamp: ParseTimestamp) {}

  public processEvent(event: LiveTableEvent<TableRow>) {
    if (this.buffering) {
      this.bufferedEvents.push(event);
      return;
    }

    const { type, record } = validate(event);
    switch (type) {
      case 'INSERT': {
        if (this.recordById.has(record.id)) {
          const existing = this.recordById.get(record.id)!;
          // If the timestamp of the existing record is the same as the event timestamp, we'll ignore this event
          const recordTimestamp = this.parseTimestamp(record.updated_at || record.created_at);
          const existingTimestamp = this.parseTimestamp(
            existing?.updated_at || existing?.created_at,
          );
          if (recordTimestamp === existingTimestamp) {
            return;
          }

          throw new Error(
            `Conflicting insert. We already have ${JSON.stringify(
              existing,
            )} from a snapshot. Cannot insert ${JSON.stringify(record)}`,
          );
        }
        this.recordById.set(record.id, record);
        break;
      }
      case 'UPDATE': {
        if (!this.recordById.has(record.id)) {
          throw new Error(`Cannot update. Record does not exist: ${JSON.stringify(record)}`);
        }
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

  processSnapshot(records: readonly TableRow[]) {
    let snapshotTimestamp = 0;
    for (const record of records) {
      const recordTimestamp = this.parseTimestamp(record.updated_at || record.created_at);
      if (recordTimestamp > snapshotTimestamp) {
        snapshotTimestamp = recordTimestamp;
      }
      this.recordById.set(record.id, record);
    }
    this.buffering = false;
    for (const event of this.bufferedEvents) {
      const eventTimestamp = this.parseTimestamp(event.timestamp);
      if (eventTimestamp < snapshotTimestamp) {
        // This event is older than the snapshot, so we can ignore it
        continue;
      }
      this.processEvent(event);
    }
  }

  /**
   * Returns the replica of the table as an array of records.
   * The records are not sorted, and there is no guarantee of order.
   */
  get records(): readonly TableRow[] {
    return [...this.recordById.values()];
  }
}

function validate<TableRow extends LiveRow>(
  event: LiveTableEvent<TableRow>,
): LiveTableEvent<TableRow> {
  const { timestamp, record, type } = event;
  const eventTimestamp = new Date(timestamp);
  if (type === 'DELETE') {
    // Delete events don't have timestamps on the record - just the id
    return event;
  }
  if (!record.created_at) {
    throw new Error(`Record has no created_at. Event: ${JSON.stringify(event)}`);
  }
  const recordTimestamp = new Date(record.updated_at || record.created_at);
  if (eventTimestamp < recordTimestamp) {
    throw new Error(
      `Event timestamp ${timestamp} is older than record timestamp ${recordTimestamp}`,
    );
  }
  return event;
}
