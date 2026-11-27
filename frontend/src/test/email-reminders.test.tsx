import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ReminderPolicy } from '../components/email-registry/ReminderPolicy'
import Emails from '../pages/Emails'

const mocks = vi.hoisted(()=>({get:vi.fn(),patch:vi.fn(),role:'owner',enabled:false,id:'u1',workspace:'w1'}))
vi.mock('../lib/api',async original=>({...await original<typeof import('../lib/api')>(),api:mocks}))
vi.mock('../hooks/useAuth',()=>({useAuth:()=>({user:{id:mocks.id,role:mocks.role,workspace:{id:mocks.workspace}}})}))
const endpoint = '/api/v1/email-registry/reminder-policy'
const field = 'email_registry_in_app_reminders_enabled'
function mount(full=false, route='/assets/emails') {
 const client = new QueryClient({defaultOptions:{queries:{retry:false}}})
 return {...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{full ? <Emails/> : <ReminderPolicy scope={`${mocks.workspace}:${mocks.id}:${mocks.role}`} />}</MemoryRouter></QueryClientProvider>),client}
}
beforeEach(()=>{
 mocks.role='owner';mocks.enabled=false;mocks.id='u1';mocks.workspace='w1'
 mocks.get.mockImplementation((p:string)=>Promise.resolve(p===endpoint ? {[field]:mocks.enabled} : p.includes('eligible-members') ? [] : {items:[],total:0,total_pages:2,page:1,page_size:25}))
 mocks.patch.mockImplementation(async (_p:string,data:Record<string,boolean>)=>{mocks.enabled=data[field];return {[field]:mocks.enabled}})
})
afterEach(()=>{cleanup();vi.resetAllMocks()})
it.each(['owner','admin'])('%s reads, patches only registry boolean and confirms by GET',async role=>{
 mocks.role=role; mount();const toggle=await screen.findByRole('checkbox');expect(toggle).not.toBeChecked()
 await userEvent.click(toggle)
 await waitFor(()=>expect(toggle).toBeChecked())
 expect(mocks.patch).toHaveBeenCalledWith(endpoint,{[field]:true})
 expect(mocks.get.mock.calls.filter(([p])=>p===endpoint)).toHaveLength(2)
 await userEvent.click(toggle);await waitFor(()=>expect(toggle).not.toBeChecked())
})
it.each(['buyer','viewer','auditor'])('%s never requests policy config',async role=>{
 mocks.role=role;mount(true);await waitFor(()=>expect(screen.queryByRole('checkbox')).not.toBeInTheDocument())
 expect(mocks.get.mock.calls.some(([p])=>p===endpoint)).toBe(false)
})
it('initial GET failure has safe error and no fabricated toggle state',async()=>{
 mocks.get.mockRejectedValue(new Error('private@example.com'));mount()
 expect(await screen.findByRole('alert')).toHaveTextContent('chưa được xác nhận')
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByText(/private@example/)).not.toBeInTheDocument()
})
it.each(['patch','readback'])('%s failure remains unconfirmed; retry reads actual state',async phase=>{
 mount();const toggle=await screen.findByRole('checkbox')
 if(phase==='patch')mocks.patch.mockRejectedValue(new Error('private@example.com'))
 else mocks.get.mockRejectedValueOnce(new Error('private@example.com'))
 await userEvent.click(toggle)
 expect(await screen.findByRole('alert')).toHaveTextContent('chưa được xác nhận')
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
 await userEvent.click(screen.getByRole('button',{name:'Tải lại'}))
 const confirmed=await screen.findByRole('checkbox')
 expect((confirmed as HTMLInputElement).checked).toBe(phase==='readback')
})
it.each(['owner','admin','buyer'])('%s attention filter resets page and sends query',async role=>{
 mocks.role=role;mount(true,'/assets/emails?page=2')
 await screen.findByText('Không có email trong phạm vi/bộ lọc hiện tại.')
 await userEvent.selectOptions(screen.getByLabelText('Cần xem lại trong ứng dụng'),'true')
 await waitFor(()=>expect(mocks.get).toHaveBeenCalledWith(expect.stringMatching(/page=1.*attention=true/)))
})
it('policy cache uses complete user workspace role scope',async()=>{
 const {client}=mount();await screen.findByRole('checkbox')
 expect(client.getQueryCache().getAll().map(q=>q.queryKey)).toContainEqual(['email-registry','w1:u1:owner','reminder-policy'])
})
it('waits for readback without showing optimistic enabled state and refreshes list',async()=>{
 const {client}=mount(true);const toggle=await screen.findByRole('checkbox')
 const invalidate=vi.spyOn(client,'invalidateQueries')
 let finish:(value:unknown)=>void=()=>{}
 mocks.get.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await userEvent.click(toggle)
 await waitFor(()=>expect(mocks.patch).toHaveBeenCalledOnce())
 expect(toggle).not.toBeChecked();expect(toggle).toBeDisabled()
 finish({[field]:true})
 await waitFor(()=>expect(toggle).toBeChecked())
 expect(invalidate).toHaveBeenCalledWith({queryKey:['email-registry','w1:u1:owner','list']})
})
it('rejects malformed policy readback instead of inventing off',async()=>{
 mocks.get.mockResolvedValue({});mount()
 expect(await screen.findByRole('alert')).toBeInTheDocument()
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
