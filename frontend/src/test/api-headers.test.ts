import { afterEach, expect, it, vi } from 'vitest'
import { api, setToken } from '../lib/api'
afterEach(()=>{vi.unstubAllGlobals();setToken(null)})
it('preserves existing JSON/auth calls and supports optional quoted If-Match',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetcher);setToken('test-session')
 await api.post('/old',{existing:true});await api.patch('/new',{state:'unknown'},{'If-Match':'"9"'});await api.post('/new/archive',{}, {'If-Match':'"10"'});await api.get('/api/v1/email-registry')
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer test-session','Content-Type':'application/json'},body:'{"existing":true}'})
 expect(fetcher.mock.calls[1][1].headers).toEqual({Authorization:'Bearer test-session','Content-Type':'application/json','If-Match':'"9"'})
 expect(fetcher.mock.calls[3][1].cache).toBe('no-store')
 expect(fetcher.mock.calls[0][1].cache).toBeUndefined()
 expect(fetcher.mock.calls[2][1].headers['If-Match']).toBe('"10"')
})
