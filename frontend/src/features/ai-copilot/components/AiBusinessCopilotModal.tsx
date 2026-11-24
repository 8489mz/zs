import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import type { AiBusinessCopilotModalProps, Message, KnowledgeSource, ReasoningStep } from './ai-business-copilot-modal/ai-business-copilot-modal-shared';
import { AiBusinessCopilotModalStyle } from './ai-business-copilot-modal/ai-business-copilot-modal-style';
import { AiBusinessCopilotModalHeader } from './ai-business-copilot-modal/ai-business-copilot-modal-header';
import { AiBusinessCopilotModalChat } from './ai-business-copilot-modal/ai-business-copilot-modal-chat';
import { AiBusinessCopilotModalKnowledge } from './ai-business-copilot-modal/ai-business-copilot-modal-knowledge';


export function AiBusinessCopilotModal({ open, onClose }: AiBusinessCopilotModalProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});

  // Knowledge Base State
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState('policy');
  const [docContent, setDocContent] = useState('');

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: 'أهلاً بك يا فندم! أنا **زاد AI**، مستشارك التنفيذي وشريكك التجاري.\nأنا متصل مباشرة بقاعدة بيانات نشاطك ومستودع المعرفة المرجعية.\nيمكنك استشارتي في مبيعاتك، تدفقات السيولة، مديونيات العملاء، أو طلب أفكار وحلول غير تقليدية لتعظيم الربحية وتصريف البضاعة الراكدة!',
      suggestedQuestions: [
        'ما موقف مبيعات وسيولة اليوم؟',
        'اقترح فكرة بره الصندوق لزيادة الأرباح',
        'من هم أكبر العملاء مديونية؟',
      ],
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (open && activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, open, activeTab]);

  // Query Knowledge Sources
  const { data: sources = [], isLoading: isLoadingSources, refetch: refetchSources } = useQuery<KnowledgeSource[]>({
    queryKey: ['ai-knowledge-sources'],
    queryFn: () => http<KnowledgeSource[]>('/api/ai-copilot/knowledge/sources'),
    enabled: open && activeTab === 'knowledge',
  });

  // Agent Chat Mutation
  const chatMutation = useMutation({
    mutationFn: (messageText: string) =>
      http<{
        sessionId: string;
        answer: string;
        reasoningSteps: ReasoningStep[];
        suggestedQuestions: string[];
        toolsUsed: string[];
      }>('/api/ai-copilot/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ message: messageText, ...(sessionId ? { sessionId } : {}) }),
      }),
    onSuccess: (data) => {
      if (data.sessionId) setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: 'ai',
          text: data.answer,
          suggestedQuestions: data.suggestedQuestions,
          reasoningSteps: data.reasoningSteps,
          toolsUsed: data.toolsUsed,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: 'ai',
          text: 'عذراً، حدث خطأ أثناء تحليل الاستعلام. يرجى إعادة المحاولة.',
        },
      ]);
    },
  });

  // Add Knowledge Source Mutation
  const addDocMutation = useMutation({
    mutationFn: () =>
      http('/api/ai-copilot/knowledge/sources', {
        method: 'POST',
        body: JSON.stringify({
          title: docTitle,
          sourceType: docType,
          rawText: docContent,
        }),
      }),
    onSuccess: () => {
      toast.success('تمت إضافة الوثيقة وتضمينها بنجاح في عقل زاد AI.');
      setDocTitle('');
      setDocContent('');
      setIsAddingDoc(false);
      refetchSources();
    },
    onError: () => {
      toast.error('فشل في حفظ الوثيقة، يرجى التأكد من ملء العنوان والمحتوى.');
    },
  });

  // Delete Knowledge Source Mutation
  const deleteDocMutation = useMutation({
    mutationFn: (id: number) =>
      http(`/api/ai-copilot/knowledge/sources/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('تم حذف الوثيقة من مستودع المعرفة.');
      refetchSources();
    },
  });

  // Auto-Index Catalog Mutation
  const autoIndexMutation = useMutation({
    mutationFn: () => http('/api/ai-copilot/knowledge/auto-index-products', { method: 'POST' }),
    onSuccess: () => {
      toast.success('تمت فهرسة كتالوج الأصناف تلقائياً وتحديث محرك البحث الدلالي.');
      refetchSources();
    },
    onError: () => {
      toast.error('حدث خطأ أثناء فهرسة الأصناف.');
    },
  });

  const handleSend = (textToSend?: string) => {
    const q = (textToSend || input).trim();
    if (!q || chatMutation.isPending) return;

    setMessages((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        sender: 'user',
        text: q,
      },
    ]);

    setInput('');
    chatMutation.mutate(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleReasoning = (messageId: string) => {
    setExpandedReasoning((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const handleResetChat = () => {
    setSessionId(null);
    setMessages([
      {
        id: 'welcome_new',
        sender: 'ai',
        text: 'تم بدء جلسة محادثة جديدة. تفضل بسؤالي عن أي جانب في أرقامك أو سياساتك أو استراتيجيات البيع!',
        suggestedQuestions: ['فحص مبيعات اليوم', 'أفكار بره الصندوق لزيادة الأرباح'],
      },
    ]);
  };

  return (
    <DialogShell open={open} onClose={onClose} ariaLabel={t('ai_copilot.ai_business_copilot_modal.s0', "مستشارك التنفيذي - زاد AI")} width="min(820px, 95vw)">
      <AiBusinessCopilotModalStyle />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'min(620px, 86vh)', maxHeight: '86vh' }} dir="rtl">
        <AiBusinessCopilotModalHeader
          t={t}
          setActiveTab={setActiveTab}
          activeTab={activeTab}
          onClose={onClose}
        />

        <AiBusinessCopilotModalChat
          activeTab={activeTab}
          messages={messages}
          expandedReasoning={expandedReasoning}
          toggleReasoning={toggleReasoning}
          t={t}
          handleSend={handleSend}
          chatMutation={chatMutation}
          messagesEndRef={messagesEndRef}
          handleResetChat={handleResetChat}
          isEn={isEn}
          input={input}
          setInput={setInput}
          handleKeyDown={handleKeyDown}
        />

        <AiBusinessCopilotModalKnowledge
          activeTab={activeTab}
          t={t}
          autoIndexMutation={autoIndexMutation}
          setIsAddingDoc={setIsAddingDoc}
          isAddingDoc={isAddingDoc}
          docTitle={docTitle}
          setDocTitle={setDocTitle}
          docType={docType}
          setDocType={setDocType}
          docContent={docContent}
          setDocContent={setDocContent}
          addDocMutation={addDocMutation}
          sources={sources}
          isLoadingSources={isLoadingSources}
          deleteDocMutation={deleteDocMutation}
        />
      </div>
    </DialogShell>
  );
}
