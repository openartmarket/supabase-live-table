### replays updates that are more recent than snapshot and arrived before

```mermaid
sequenceDiagram
  LiveTable->>+Supabase: subscribe
  Supabase->>-LiveTable: subscription active
  LiveTable->>+Supabase: get snapshot
  Supabase-->>LiveTable: UPDATE {"id":1,"created_at":"1","updated_at":"3","name":"Bike","type":"vehicle"}
  Supabase->>-LiveTable: snaphot: [{"id":1,"created_at":"1","updated_at":"2","name":"Bicycle","type":"vehicle"}]
```

### replica
```json
[
  {
    "id": 1,
    "created_at": "1",
    "updated_at": "3",
    "name": "Bike",
    "type": "vehicle"
  }
]
```
