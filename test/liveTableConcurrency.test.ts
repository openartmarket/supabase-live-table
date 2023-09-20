import { describe, it, expect } from 'vitest'
import { LiveTable } from '../src'
import { Database } from './Database'

type ThingRow = Database['public']['Tables']['thing']['Row']

describe('LiveTable Concurrency', () => {
  it('check', async () => {
    const lt = new LiveTable<ThingRow>()

    lt.initial([])
  })
})
