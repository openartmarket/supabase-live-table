import { describe, it, expect } from 'vitest';
import { ILiveTable, LiveTable, LiveTableEvent, LiveRow } from '../src';
import fs from 'fs';
import { Writable } from 'stream';

type ThingRow = LiveRow & {
  id: number;
  name: string;
};

const t1 = '2023-09-21T22:28:00.00Z';
const t2 = '2023-09-21T22:28:00.01Z';
const t3 = '2023-09-21T22:28:00.02Z';

describe('LiveTable Buffering', () => {
  it('skips events that predate the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

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
    lt.processSnapshot([snapshotRecord]);

    expect(lt.records).toEqual([snapshotRecord]);

    await lt.close();
  });

  it('replays updates that arrived after the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

    const snapshotRecord = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'One',
    };
    lt.processSnapshot([snapshotRecord]);

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t2,
      updated_at: t3,
      name: 'Un',
    };
    lt.processEvent({ timestamp: t3, type: 'UPDATE', record: streamRecord });

    expect(lt.records).toEqual([streamRecord]);

    await lt.close();
  });

  it('replays deletes that arrived after the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();
    lt.processSnapshot([{ created_at: t1, updated_at: null, id: 1, name: 'One' }]);

    lt.processEvent({ timestamp: t2, type: 'DELETE', record: { id: 1 } });

    expect(lt.records).toEqual([]);

    await lt.close();
  });

  it('rejects conflicting inserts when the timestamps are different', async () => {
    const lt = new LiveTable<ThingRow>();

    const record = { id: 1, created_at: t1, updated_at: null, name: 'Un' };
    lt.processEvent({ timestamp: t2, type: 'INSERT', record: { ...record, created_at: t2 } });
    expect(() => lt.processSnapshot([record])).toThrowError(/Conflicting insert/);
  });

  it('ignores conflicting inserts when the timestamps are identical', async () => {
    const lt = new LiveTable<ThingRow>();

    const record = { id: 1, created_at: t1, updated_at: null, name: 'Un' };
    lt.processEvent({ timestamp: t1, type: 'INSERT', record });
    lt.processSnapshot([record]);
    expect(lt.records).toEqual([record]);
  });
});

export class MermaidLiveTable<TableRow extends LiveRow> implements ILiveTable<TableRow> {
  private readonly fileStream: Writable;

  constructor(private readonly delegate: ILiveTable<TableRow>, name: string) {
    const path = `./docs/${name.toLowerCase().replace(/\s/g, '-')}.md`;
    this.fileStream = fs.createWriteStream(path, 'utf-8');
    this.fileStream.write(`### ${name}\n`);
    this.fileStream.write('```mermaid\n');
    this.fileStream.write('sequenceDiagram\n');
  }

  processSnapshot(records: readonly TableRow[]) {
    this.fileStream.write(`  Supabase->>-LiveTable: snaphot: ${JSON.stringify(records.map(p))}\n`);
    this.delegate.processSnapshot(records);
  }

  processEvent(event: LiveTableEvent<TableRow>) {
    const { type, record } = event;
    const { id, name } = record;
    this.fileStream.write(`  Supabase-->>LiveTable: ${type} ${JSON.stringify({ id, name })}\n`);
    this.delegate.processEvent(event);
  }

  get records(): readonly TableRow[] {
    return this.delegate.records;
  }

  subscribe() {
    this.write(`  LiveTable->>+Supabase: subscribe\n`);
  }

  subscribed() {
    this.write(`  Supabase->>-LiveTable: subscription active\n`);
  }

  requestSnapshot() {
    this.write(`  LiveTable->>+Supabase: get snapshot\n`);
  }

  async write(text: string) {
    this.fileStream.write(text);
  }

  async close() {
    return new Promise((resolve) => {
      this.fileStream.write('```\n\n');
      this.fileStream.write('```json\n');
      this.fileStream.write(JSON.stringify(this.records, null, 2));
      this.fileStream.write('\n```\n');
      this.fileStream.end(resolve);
    });
  }
}

function p({ id, name }: Partial<LiveRow>) {
  return { id, name };
}
