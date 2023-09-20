import { describe, it, expect } from 'vitest'
import { LiveTable } from '../src'

type ThingRow = {
  id: number,
  name: string,
}

describe('LiveTable Buffering', () => {
  it('buffers updates', async () => {
    const lt = new LiveTable<ThingRow>()

    lt.updated({ id: 1, name: 'Un' })
    lt.initial([{ id: 1, name: 'One' }])
    
    expect(lt.records).toEqual([{ id: 1, name: 'Un' }])
  })

  it('buffers deletes', async () => {
    const lt = new LiveTable<ThingRow>()

    lt.deleted({ id: 1 })
    lt.initial([{ id: 1, name: 'One' }])
    
    expect(lt.records).toEqual([])
  })

  it('buffers inserts', async () => {
    const lt = new LiveTable<ThingRow>()

    lt.inserted({ id: 1, name: 'Un' })
    lt.initial([{ id: 1, name: 'One' }])
    
    expect(lt.records).toEqual([{ id: 1, name: 'Un' }])
  })
})
