### replays updates that arrived after the snapshot

```mermaid
sequenceDiagram
  LiveTable->>+Supabase: subscribe
  Supabase->>-LiveTable: subscription active
  LiveTable->>+Supabase: get snapshot
  Supabase->>-LiveTable: snaphot: [{"id":1,"created_at":"1","updated_at":"2","name":"Bicycle","type":"vehicle"}]
  Supabase-->>LiveTable: UPDATE {"id":1,"created_at":"2","updated_at":"3","name":"Bike","type":"vehicle"}
```

### replica
```json
[
  {
    "id": 1,
    "created_at": "2",
    "updated_at": "3",
    "name": "Bike",
    "type": "vehicle"
  }
]
```
