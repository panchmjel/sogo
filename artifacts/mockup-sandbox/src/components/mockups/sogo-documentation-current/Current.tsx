import { useState } from 'react';
import { ProjectDocumentationPanel } from './ProjectDocumentationUI';
import './_group.css';

const scopeDocuments = [
  {
    documentId: 'scope-specification',
    filename: 'Specyfikacja techniczna — fundamenty.pdf',
    size: 1_842_300,
    contentType: 'application/pdf',
    status: 'UPLOADED',
  },
];

const projectDocuments = [
  {
    documentId: 'project-drawings',
    filename: 'Rysunki konstrukcyjne — fundamenty.pdf',
    size: 2_410_000,
    contentType: 'application/pdf',
    status: 'UPLOADED',
  },
  {
    documentId: 'project-soil',
    filename: 'Opinia geotechniczna.pdf',
    size: 940_000,
    contentType: 'application/pdf',
    status: 'UPLOADED',
  },
];

export function Current() {
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(['scope-specification', 'project-drawings']);
  const [documentationName, setDocumentationName] = useState('Fundamenty — materiały');
  const [preparationRequest, setPreparationRequest] = useState('Przygotuj materiały do wykonania ław i ścian fundamentowych. Uwzględnij ilości z dokumentacji.');
  const [purchaseRules, setPurchaseRules] = useState([
    'Pomiń przyłącza i instalacje prowadzone poza obrysem fundamentów.',
    'Jeśli ilość nie wynika z dokumentacji, oznacz ją do sprawdzenia.',
  ]);

  const toggleDocument = (documentId: string) => {
    setSelectedDocumentIds((current) => current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId]);
  };

  return (
    <div className="sogo-noise min-h-screen bg-background text-foreground">
      <ProjectDocumentationPanel
        open
        onClose={() => undefined}
        scopeDocuments={scopeDocuments}
        projectDocuments={projectDocuments}
        selectedDocumentIds={selectedDocumentIds}
        onToggleDocument={toggleDocument}
        onRemoveDocument={toggleDocument}
        onFilesAdded={() => undefined}
        onPasteContent={() => undefined}
        documentationName={documentationName}
        onDocumentationNameChange={setDocumentationName}
        preparationRequest={preparationRequest}
        onPreparationRequestChange={setPreparationRequest}
        mode="APPEND"
        onModeChange={() => undefined}
        onPrepare={() => undefined}
        onApplyResult={() => undefined}
        purchaseRules={purchaseRules}
        onPurchaseRuleChange={(index, value) => setPurchaseRules((rules) => rules.map((rule, ruleIndex) => ruleIndex === index ? value : rule))}
        onAddPurchaseRule={() => setPurchaseRules((rules) => [...rules, ''])}
        onRemovePurchaseRule={(index) => setPurchaseRules((rules) => rules.filter((_, ruleIndex) => ruleIndex !== index))}
        maxFiles={12}
      />
    </div>
  );
}
