import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, type Project } from '../lib/api';
import type { Invoice } from '../lib/invoices-api';
import { useApiSession } from '../lib/app-session';
const button='rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50';
export function ProjectPrivacy({project}:{project:Project}) {
 const session=useApiSession(); const client=useQueryClient();
 const change=useMutation({mutationFn:()=>apiRequest('set_project_privacy',{projectId:project.projectId,isPrivate:!project.isPrivate}),onSuccess:()=>client.invalidateQueries({queryKey:['projects']})});
 return <div className="flex flex-wrap items-center gap-3 p-3 text-sm"><span>{project.isPrivate?'Prywatny':'Wspólny — wszyscy użytkownicy'}</span>{project.ownerId===session.authUserId&&<button className={button} disabled={change.isPending} onClick={()=>change.mutate()}>{project.isPrivate?'Udostępnij wszystkim':'Ustaw jako prywatny'}</button>}{change.isError&&<p role="alert">Nie udało się zmienić prywatności. Odśwież i spróbuj ponownie.</p>}</div>;
}
export function InvoiceSharing({invoice,onSaved}:{invoice:Invoice;onSaved:()=>void}) {
 const session=useApiSession();const client=useQueryClient(); const owner=invoice.ownerId===session.authUserId;
 const [open,setOpen]=useState(false);const [selected,setSelected]=useState<string[]>([]);
 const users=useQuery({queryKey:['invoice-share-users',session.authUserId,invoice.invoiceId],queryFn:()=>apiRequest<{items:{userId:string;name:string;email:string}[]}>('invoice_share_users',{invoiceId:invoice.invoiceId}),enabled:open&&owner,retry:false});
 const save=useMutation({mutationFn:()=>apiRequest('share_invoice',{invoiceId:invoice.invoiceId,expectedRevision:invoice.revision,sharedWith:selected}),onSuccess:()=>{setOpen(false);onSaved();void client.invalidateQueries({queryKey:['invoices']});}});
 return <section className="mt-5 rounded-xl border border-border p-4"><div className="flex items-center justify-between gap-3"><p>{owner?(invoice.sharedWith?.length?`Udostępniona ${invoice.sharedWith.length} osobom`:'Prywatna — widzisz ją tylko Ty'):'Udostępniona Tobie — tylko podgląd'}</p>{owner&&<button className={button} onClick={()=>{setSelected(invoice.sharedWith??[]);setOpen(!open);save.reset();}}>Udostępnij</button>}</div>{open&&<div className="mt-4 space-y-3"><p className="text-sm text-muted-foreground">Wybierz osoby, które mogą oglądać fakturę. Odznaczenie osoby odbierze jej dostęp. Przypisanie projektu nie udostępnia faktury.</p>{users.isPending?<p>Wczytywanie użytkowników…</p>:users.isError?<p role="alert">Nie udało się pobrać użytkowników.</p>:users.data?.items.map(u=><label key={u.userId} className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(u.userId)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,u.userId]:prev.filter(x=>x!==u.userId))}/>{u.name||u.email} {u.name&&`(${u.email})`}</label>)}{save.isError&&<p role="alert">Nie udało się zapisać udostępnienia. Odśwież fakturę i spróbuj ponownie.</p>}<button className={button} disabled={save.isPending||!users.data} onClick={()=>save.mutate()}>{save.isPending?'Zapisywanie…':'Zapisz udostępnienie'}</button></div>}</section>;
}
