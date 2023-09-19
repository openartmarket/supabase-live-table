import { describe, it, beforeEach, expect } from 'vitest'
import { liveTable } from '../src'
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from './Database'

type ThingRow = Database['public']['Tables']['thing']['Row']

describe('liveTable', () => {
  const supabase = new SupabaseClient<Database>('http://localhost:50321', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU', {
    auth: {
      persistSession: false
    }
  })

  beforeEach(async () => {
    await supabase.from('thing').delete().neq('type', '').throwOnError()
  })

  it('filters on column', async () => {
    await hasRecords(['bicycle'], async () => {
      await supabase.from('thing').insert([
        { type: 'ignored', name: 'skateboard' },
        { type: 'vehicle', name: 'bicycle' },
        { type: 'ignored', name: 'zeppelin' },
      ]).throwOnError()
    })
  })

  it('handles inserts', async () => {
    await hasRecords(['skateboard'], async () => {
      await supabase.from('thing').insert({ type: 'vehicle', name: 'skateboard' }).throwOnError()
    })
  })

  it('handles deletes', async () => {
    await hasRecords(['skateboard'], async () => {
      await supabase.from('thing').insert([
        { type: 'vehicle', name: 'skateboard' },
        { type: 'vehicle', name: 'bicycle' },
        { type: 'vehicle', name: 'zeppelin' },
      ]).throwOnError()
      await supabase.from('thing').delete().eq('name', 'bicycle').throwOnError()
    })
  })

  it('handles updates', async () => {
    await hasRecords(['bike', 'skateboard', 'zeppelin'], async () => {
      await supabase.from('thing').insert([
        { type: 'vehicle', name: 'skateboard' },
        { type: 'vehicle', name: 'bicycle' },
        { type: 'vehicle', name: 'zeppelin' },
      ]).throwOnError()
      await supabase.from('thing').update({name: 'bike'}).eq('name', 'bicycle').throwOnError()
    })
  })

  async function hasRecords(expected: readonly string[], write: () => Promise<void>): Promise<void> {
    let error: Error | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const success = new Promise<void>((resolve, reject) => {
      const channel = liveTable<ThingRow, 'type'>(supabase, {
        tableName: 'thing',
        columnName: 'type',
        columnValue: 'vehicle',
        channelName: 'thing:vehicle',
        callback: (err, records) => {
          if (err) return reject(err)
          const names = [...records].map(r => r.name).sort()
          try {
            expect(names).toEqual(expected)
            channel.unsubscribe().then(() => resolve()).catch(reject)
          } catch (err) {
            error = err
          }
        }
      })
      write().catch(reject)
    })

    const timeout = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(error || new Error('No messages(?!)')), 1000)
    })

    await Promise.race([success, timeout])
  }
})
