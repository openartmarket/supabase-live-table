import { describe, it, expect } from 'vitest';
import { ILiveTable, LiveTable, LiveTableEvent, LiveRow } from '../src';

type ThingRow = LiveRow & {
  id: number;
  name: string;
};

const t1 = '2023-09-21T22:28:00.00Z';
const t2 = '2023-09-21T22:28:00.01Z';
const t3 = '2023-09-21T22:28:00.02Z';

describe('LiveTable Buffering', () => {
  it('replays events that arrived after snapshots', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t2,
      updated_at: t3,
      name: 'Un',
    };
    lt.processEvent({ timestamp: t3, type: 'UPDATE', record: streamRecord });

    const snapshotRecord = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'One',
    };
    lt.snapshot([snapshotRecord]);

    expect(lt.records).toEqual([streamRecord]);
  });

  it('skips events that predate the snapshot', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'Un',
    };
    lt.processEvent({ timestamp: t2, type: 'UPDATE', record: streamRecord });

    const snapshotRecord: ThingRow = {
      id: 1,
      created_at: t2,
      updated_at: t3,
      name: 'One',
    };
    lt.snapshot([snapshotRecord]);

    expect(lt.records).toEqual([snapshotRecord]);
  });

  it('buffers deletes', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    console.log(`LiveTable->>+Supabase: subscribe()`);
    console.log(`Supabase-->>-LiveTable: subscribed()`);
    lt.processEvent({ timestamp: t2, type: 'DELETE', record: { id: 1, created_at: t2 } });
    console.log(`LiveTable->>+Supabase: snaphot()`);
    lt.snapshot([{ created_at: t1, updated_at: null, id: 1, name: 'One' }]);

    expect(lt.records).toEqual([]);

    console.log(JSON.stringify(lt.records, null, 2));
  });

  it('rejects conflicting inserts when the timestamps are different', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    const record = { id: 1, created_at: t1, updated_at: null, name: 'Un' };
    lt.processEvent({ timestamp: t2, type: 'INSERT', record: { ...record, created_at: t2 } });
    expect(() => lt.snapshot([record])).toThrowError(/Conflicting insert/);
  });

  it('ignores conflicting inserts when the timestamps are identical', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    const record = { id: 1, created_at: t1, updated_at: null, name: 'Un' };
    lt.processEvent({ timestamp: t1, type: 'INSERT', record });
    lt.snapshot([record]);
    expect(lt.records).toEqual([record]);
  });
});

export class MermaidLiveTable<TableRow extends LiveRow> implements ILiveTable<TableRow> {
  constructor(private readonly delegate: ILiveTable<TableRow>) {}

  snapshot(records: readonly TableRow[]) {
    console.log(`LiveTable->>+Supabase: snaphot( ${JSON.stringify(records.map(p))} )`);
    this.delegate.snapshot(records);
  }

  processEvent(event: LiveTableEvent<TableRow>) {
    console.log(`LiveTable->>-Supabase: processEvent( ${JSON.stringify(event)} )`);
    this.delegate.processEvent(event);
  }

  get records(): readonly TableRow[] {
    return this.delegate.records;
  }
}

function p({ id, name }: Partial<LiveRow>) {
  return { id, name };
}
