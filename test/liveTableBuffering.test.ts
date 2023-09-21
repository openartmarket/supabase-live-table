import { describe, it, expect } from 'vitest';
import { ILiveTable, LiveTable, LiveTableEvent, Row } from '../src';

type ThingRow = {
  id: number;
  name: string;
};

describe('LiveTable Buffering', () => {
  it('buffers updates', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    lt.processEvent({ type: 'UPDATE', record: { id: 1, name: 'Un' } });
    lt.snapshot([{ id: 1, name: 'One' }]);

    expect(lt.records).toEqual([{ id: 1, name: 'Un' }]);
  });

  it('buffers deletes', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    console.log(`LiveTable->>+Supabase: subscribe()`);
    console.log(`Supabase-->>-LiveTable: subscribed()`);
    lt.processEvent({ type: 'DELETE', record: { id: 1 } });
    console.log(`LiveTable->>+Supabase: snaphot()`);
    lt.snapshot([{ id: 1, name: 'One' }]);

    expect(lt.records).toEqual([]);

    console.log(JSON.stringify(lt.records, null, 2));
  });

  it('buffers inserts', async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    lt.processEvent({ type: 'INSERT', record: { id: 1, name: 'Un' } });
    lt.snapshot([{ id: 1, name: 'One' }]);

    expect(lt.records).toEqual([{ id: 1, name: 'Un' }]);
  });
});

export class MermaidLiveTable<TableRow extends Row> implements ILiveTable<TableRow> {
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

function p({ id, name }: Partial<Row>) {
  return { id, name };
}
