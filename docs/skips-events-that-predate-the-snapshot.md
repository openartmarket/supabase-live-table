### skips events that predate the snapshot
```mermaid
sequenceDiagram
  LiveTable->>-Supabase: processEvent( {"timestamp":"2023-09-21T22:28:00.01Z","type":"UPDATE","record":{"id":1,"created_at":"2023-09-21T22:28:00.00Z","updated_at":"2023-09-21T22:28:00.01Z","name":"Un"}} )
  LiveTable->>+Supabase: snaphot( [{"id":1,"name":"One"}] )
```

```json
[
  {
    "id": 1,
    "created_at": "2023-09-21T22:28:00.01Z",
    "updated_at": "2023-09-21T22:28:00.02Z",
    "name": "One"
  }
]
```
