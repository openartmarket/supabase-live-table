### replays delets that arrived after the snapshot
```mermaid
sequenceDiagram
  LiveTable->>+Supabase: subscribe()
  Supabase-->>-LiveTable: subscribed()
  LiveTable->>-Supabase: processEvent( {"timestamp":"2023-09-21T22:28:00.01Z","type":"DELETE","record":{"id":1,"created_at":"2023-09-21T22:28:00.01Z"}} )
  LiveTable->>+Supabase: snaphot()
  LiveTable->>+Supabase: snaphot( [{"id":1,"name":"One"}] )
```

```json
[]
```
