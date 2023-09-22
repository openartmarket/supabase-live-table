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

    await lt.close();
  });

  it('replays updates that arrived after the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(), test.task.name);

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

    await lt.close();
  });

  it('replays delets that arrived after the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(), test.task.name);

    lt.write(`  LiveTable->>+Supabase: subscribe()\n`);
    lt.write(`  Supabase-->>-LiveTable: subscribed()\n`);
    lt.processEvent({ timestamp: t2, type: 'DELETE', record: { id: 1, created_at: t2 } });
    lt.write(`  LiveTable->>+Supabase: snaphot()\n`);
    lt.snapshot([{ created_at: t1, updated_at: null, id: 1, name: 'One' }]);

    expect(lt.records).toEqual([]);

    await lt.close();
  });

  it('rejects conflicting inserts when the timestamps are different', async () => {
    const lt = new LiveTable<ThingRow>();

    const record = { id: 1, created_at: t1, updated_at: null, name: 'Un' };
    lt.processEvent({ timestamp: t2, type: 'INSERT', record: { ...record, created_at: t2 } });
    expect(() => lt.snapshot([record])).toThrowError(/Conflicting insert/);
  });

  it('ignores conflicting inserts when the timestamps are identical', async () => {
    const lt = new LiveTable<ThingRow>();

    const record = { id: 1, created_at: t1, updated_at: null, name: 'Un' };
    lt.processEvent({ timestamp: t1, type: 'INSERT', record });
    lt.snapshot([record]);
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

  snapshot(records: readonly TableRow[]) {
    this.fileStream.write(
      `  LiveTable->>+Supabase: snaphot( ${JSON.stringify(records.map(p))} )\n`,
    );
    this.delegate.snapshot(records);
  }

  processEvent(event: LiveTableEvent<TableRow>) {
    this.fileStream.write(`  LiveTable->>-Supabase: processEvent( ${JSON.stringify(event)} )\n`);
    this.delegate.processEvent(event);
  }

  get records(): readonly TableRow[] {
    return this.delegate.records;
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
