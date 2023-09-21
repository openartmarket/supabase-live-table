import { describe, it, expect } from "vitest";
import { ILiveTable, LiveTable, Row } from "../src";

type ThingRow = {
  id: number;
  name: string;
};

describe("LiveTable Buffering", () => {
  it("buffers updates", async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    lt.updated({ id: 1, name: "Un" });
    lt.initial([{ id: 1, name: "One" }]);

    expect(lt.records).toEqual([{ id: 1, name: "Un" }]);
  });

  it("buffers deletes", async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    console.log(`LiveTable->>+Supabase: subscribe()`);
    console.log(`Supabase-->>-LiveTable: subscribed()`);
    lt.deleted({ id: 1 });
    console.log(`LiveTable->>+Supabase: snaphot()`);
    lt.initial([{ id: 1, name: "One" }]);

    expect(lt.records).toEqual([]);

    console.log(JSON.stringify(lt.records, null, 2));
  });

  it("buffers inserts", async () => {
    const lt = new MermaidLiveTable(new LiveTable<ThingRow>());

    lt.inserted({ id: 1, name: "Un" });
    lt.initial([{ id: 1, name: "One" }]);

    expect(lt.records).toEqual([{ id: 1, name: "Un" }]);
  });
});

export class MermaidLiveTable<TableRow extends Row>
  implements ILiveTable<TableRow>
{
  constructor(private readonly delegate: ILiveTable<TableRow>) {}

  initial(records: readonly TableRow[]) {
    console.log(
      `Supabase-->>-LiveTable: initial( ${JSON.stringify(records.map(p))} )`,
    );
    this.delegate.initial(records);
  }

  inserted(record: TableRow) {
    console.log(
      `Supabase-->>LiveTable: inserted( ${JSON.stringify(p(record))} )`,
    );
    this.delegate.inserted(record);
  }

  updated(record: TableRow) {
    console.log(
      `Supabase-->>LiveTable: updated( ${JSON.stringify(p(record))} )`,
    );
    this.delegate.updated(record);
  }

  deleted(record: Partial<TableRow>) {
    console.log(
      `Supabase-->>LiveTable: deleted( ${JSON.stringify(p(record))} )`,
    );
    this.delegate.deleted(record);
  }

  get records(): readonly TableRow[] {
    return this.delegate.records;
  }
}

function p({ id, name }: Partial<Row>) {
  return { id, name };
}
