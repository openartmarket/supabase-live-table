### skips updates that predate the snapshot and arrive after

```mermaid
sequenceDiagram
  LiveTable->>+Supabase: subscribe
  Supabase->>-LiveTable: subscription active
  LiveTable->>+Supabase: get snapshot
  Supabase->>-LiveTable: snaphot: [{"id":1,"created_at":"1","updated_at":"3","type":"vehicle","name":"Bicycle","color":"black"}]
  Supabase-->>LiveTable: UPDATE {"id":1,"created_at":"1","updated_at":"2","type":"vehicle","name":"Bike","color":"black"}
```

### replica
```json
[
  {
    "id": 1,
    "created_at": "1",
    "updated_at": "3",
    "type": "vehicle",
    "name": "Bicycle",
    "color": "black"
  }
]
```
