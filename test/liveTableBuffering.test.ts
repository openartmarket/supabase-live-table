import { describe, it, expect, beforeAll } from 'vitest';
import { ILiveTable, LiveTable, LiveTableEvent } from '../src';
import fs from 'fs';
import { rm, mkdir } from 'fs/promises';
import { Writable } from 'stream';
import { Database } from './Database';

type ThingRow = Database['public']['Tables']['thing']['Row'];

// We use integers for timestamps to make the tests and generated sequence diagrams easier to read
const t1 = '1';
const t2 = '2';
const t3 = '3';
const parseTimestamp = (timestamp: string) => +timestamp;

describe('LiveTable Buffering', () => {
  beforeAll(async () => {
    try {
      await rm('./docs/sequence-diagrams', { recursive: true });
    } catch (ignore) {
      // ignore
    }
    await mkdir('./docs/sequence-diagrams', { recursive: true });
  });

  it('skips deletes that predate the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(parseTimestamp), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

    const streamRecord: Partial<ThingRow> = {
      id: 1,
    };
    lt.processEvent({ timestamp: t2, type: 'DELETE', record: streamRecord });

    const snapshotRecord: ThingRow = {
      id: 1,
      created_at: t2,
      updated_at: t3,
      name: 'Bicycle',
      type: 'vehicle',
    };
    lt.processSnapshot([snapshotRecord]);

    expect(lt.records).toEqual([snapshotRecord]);

    await lt.close();
  });

  it('skips updates that predate the snapshot and arrive before', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(parseTimestamp), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'Bike',
      type: 'vehicle',
    };
    lt.processEvent({ timestamp: t2, type: 'UPDATE', record: streamRecord });

    const snapshotRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t3,
      name: 'Bicycle',
      type: 'vehicle',
    };
    lt.processSnapshot([snapshotRecord]);

    expect(lt.records).toEqual([snapshotRecord]);

    await lt.close();
  });

  it('skips updates that predate the snapshot and arrive after', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(parseTimestamp), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

    const snapshotRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t3,
      name: 'Bicycle',
      type: 'vehicle',
    };
    lt.processSnapshot([snapshotRecord]);

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'Bike',
      type: 'vehicle',
    };
    lt.processEvent({ timestamp: t2, type: 'UPDATE', record: streamRecord });

    expect(lt.records).toEqual([snapshotRecord]);

    await lt.close();
  });

  it('replays updates that are more recent than snapshot and arrived after', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(parseTimestamp), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

    const snapshotRecord = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'Bicycle',
      type: 'vehicle',
    };
    lt.processSnapshot([snapshotRecord]);

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t3,
      name: 'Bike',
      type: 'vehicle',
    };
    lt.processEvent({ timestamp: t3, type: 'UPDATE', record: streamRecord });

    expect(lt.records).toEqual([streamRecord]);

    await lt.close();
  });

  it('replays updates that are more recent than snapshot and arrived before', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(parseTimestamp), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();

    const streamRecord: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: t3,
      name: 'Bike',
      type: 'vehicle',
    };
    lt.processEvent({ timestamp: t3, type: 'UPDATE', record: streamRecord });

    const snapshotRecord = {
      id: 1,
      created_at: t1,
      updated_at: t2,
      name: 'Bicycle',
      type: 'vehicle',
    };
    lt.processSnapshot([snapshotRecord]);

    expect(lt.records).toEqual([streamRecord]);

    await lt.close();
  });

  it('replays deletes that arrived after the snapshot', async (test) => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>(parseTimestamp), test.task.name);

    lt.subscribe();
    lt.subscribed();
    lt.requestSnapshot();
    lt.processSnapshot([
      { created_at: t1, updated_at: null, id: 1, name: 'Bicycle', type: 'vehicle' },
    ]);

    lt.processEvent({ timestamp: t2, type: 'DELETE', record: { id: 1 } });

    expect(lt.records).toEqual([]);

    await lt.close();
  });

  it('rejects conflicting inserts when the timestamps are different', async () => {
    const lt = new LiveTable<ThingRow>(parseTimestamp);

    const record: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: null,
      name: 'Bike',
      type: 'vehicle',
    };
    lt.processEvent({ timestamp: t2, type: 'INSERT', record: { ...record, created_at: t2 } });
    expect(() => lt.processSnapshot([record])).toThrowError(/Conflicting insert/);
  });

  it('ignores conflicting inserts when the timestamps are identical', async () => {
    const lt = new LiveTable<ThingRow>(parseTimestamp);

    const record: ThingRow = {
      id: 1,
      created_at: t1,
      updated_at: null,
      name: 'Bike',
      type: 'vehicle',
    };
    lt.processEvent({ timestamp: t1, type: 'INSERT', record });
    lt.processSnapshot([record]);
    expect(lt.records).toEqual([record]);
  });
});

export class MermaidLiveTable implements ILiveTable<ThingRow> {
  private readonly fileStream: Writable;

  constructor(
    private readonly delegate: ILiveTable<ThingRow>,
    name: string,
  ) {
    const path = `./docs/sequence-diagrams/${name.toLowerCase().replace(/\s/g, '-')}.md`;
    this.fileStream = fs.createWriteStream(path, 'utf-8');
    this.fileStream.write(`### ${name}\n\n`);
    this.fileStream.write('```mermaid\n');
    this.fileStream.write('sequenceDiagram\n');
  }

  processSnapshot(records: readonly ThingRow[]) {
    this.fileStream.write(`  Supabase->>-LiveTable: snaphot: ${JSON.stringify(records)}\n`);
    this.delegate.processSnapshot(records);
  }

  processEvent(event: LiveTableEvent<ThingRow>) {
    const { type, record } = event;
    this.fileStream.write(`  Supabase-->>LiveTable: ${type} ${JSON.stringify(record)}\n`);
    this.delegate.processEvent(event);
  }

  get records(): readonly ThingRow[] {
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
      this.fileStream.write('### replica\n');
      this.fileStream.write('```json\n');
      this.fileStream.write(JSON.stringify(this.records, null, 2));
      this.fileStream.write('\n```\n');
      this.fileStream.end(resolve);
    });
  }
}
