import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, FileText, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { downloadDocument, type SogoDocument } from '@/lib/api';

export function DocumentPreview({ projectId, purchaseAreaId, document }: {
  projectId: string; purchaseAreaId: string | null; document: SogoDocument;
}) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const extension = document.filename.split('.').pop()?.toLowerCase();
  const pdf = extension === 'pdf';
  const image = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension ?? '');
  const ready = document.status === 'UPLOADED';
  const preview = useQuery({
    queryKey: ['document-preview', projectId, document.documentId, purchaseAreaId],
    queryFn: ({ signal }) => downloadDocument(projectId, document.documentId, purchaseAreaId, signal),
    enabled: ready,
    staleTime: 240_000, gcTime: 0, retry: false,
    refetchOnWindowFocus: true,
  });
  async function download() {
    setDownloading(true); setDownloadError(false);
    try {
      const result = await downloadDocument(projectId, document.documentId, purchaseAreaId, undefined, 'attachment');
      const link = window.document.createElement('a');
      link.href = result.url; link.download = document.filename;
      window.document.body.appendChild(link); link.click(); link.remove();
    } catch { setDownloadError(true); }
    finally { setDownloading(false); }
  }
  const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-secondary disabled:opacity-50';
  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Podgląd dokumentu">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <div className="flex min-w-0 items-center gap-3"><FileText className="shrink-0 text-accent" size={20} /><div className="min-w-0"><h2 className="font-bold">Podgląd pliku</h2><p className="break-all text-xs text-muted-foreground">{document.filename}</p></div></div>
      <div className="flex flex-wrap gap-2">
        {preview.data && (pdf || image) && <a className={button} href={preview.data.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Otwórz w nowej karcie</a>}
        <button className={button} onClick={() => void download()} disabled={!ready || downloading}><Download size={15} />{downloading ? 'Przygotowanie…' : 'Pobierz'}</button>
        {(pdf || image) && <button className={button} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{expanded ? 'Zmniejsz' : 'Powiększ'}</button>}
      </div>
    </header>
    {!ready ? <p className="p-8 text-sm text-muted-foreground">Podgląd będzie dostępny po zakończeniu przesyłania.</p>
      : preview.isPending ? <p className="p-12 text-center text-sm text-muted-foreground" role="status">Wczytywanie podglądu…</p>
      : preview.isError || imageFailed ? <div className="p-8 text-center" role="alert"><p>Nie udało się wyświetlić podglądu.</p><button className={`${button} mt-3`} onClick={() => { setImageFailed(false); void preview.refetch(); }}><RefreshCw size={15} />Odśwież podgląd</button></div>
      : pdf ? <iframe title={`Podgląd: ${document.filename}`} src={preview.data.url + '#view=FitH'} className={`w-full border-0 bg-secondary ${expanded ? 'h-[88vh]' : 'h-[65vh] min-h-[420px]'}`} />
      : image ? <div className={`overflow-auto bg-secondary/40 p-4 ${expanded ? 'h-[88vh]' : 'max-h-[65vh]'}`}><img src={preview.data.url} alt={document.filename} onError={() => setImageFailed(true)} className="mx-auto max-w-full rounded-lg object-contain shadow-sm" /></div>
      : <div className="p-10 text-center"><FileText size={36} className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">Ten format otworzysz w odpowiednim programie</p><p className="mt-2 text-sm text-muted-foreground">Pobierz plik i otwórz go np. w Excelu. Podgląd na stronie jest dostępny dla PDF-ów i obrazów.</p></div>}
    {pdf && preview.data && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Jeśli przeglądarka nie wyświetla PDF, wybierz „Otwórz w nowej karcie” lub „Pobierz”.</p>}
    {downloadError && <p className="p-4 text-sm text-destructive" role="alert">Nie udało się przygotować pliku. Spróbuj pobrać ponownie.</p>}
  </section>;
}
