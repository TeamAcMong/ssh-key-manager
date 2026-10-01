import { useCallback, useEffect, useState } from 'react';
import { FluentProvider, Toaster, makeStyles, tokens, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import type { AgentServiceState, EnvInfo, KeyDetail, KeyInfo, Settings, SkmErrorData } from '../core/types';
import { setLanguage, t } from './i18n/t';
import { api, call, errorData } from './lib/api';
import { isModKey } from './lib/platform';
import { Sidebar, StatusBar, type PageId } from './components/Shell';
import { ErrorCard, TOASTER_ID, useNotify } from './components/common';
import { GenerateDialog } from './components/GenerateDialog';
import { AgentPassphraseDialog } from './components/KeyDialogs';
import { KeysPage } from './pages/KeysPage';
import { SettingsPage } from './pages/SettingsPage';
import { AgentPage } from './pages/AgentPage';
import { ConfigPage } from './pages/ConfigPage';
import { TestPage } from './pages/TestPage';

const useStyles = makeStyles({
  root: { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 },
  main: { display: 'flex', flexGrow: 1, minHeight: 0 },
  content: { flexGrow: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground1 },
  error: { padding: tokens.spacingVerticalM }
});

function useSystemDark(): boolean {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return dark;
}

function Shell(props: { settings: Settings; onSettingsChanged: (s: Settings) => void }): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [page, setPage] = useState<PageId>('keys');
  const [env, setEnv] = useState<(EnvInfo & { defaultComment: string }) | null>(null);
  const [agent, setAgent] = useState<AgentServiceState | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [agentPrompt, setAgentPrompt] = useState<KeyInfo | null>(null);
  const [error, setError] = useState<SkmErrorData | null>(null);
  const [hostDraftKeyId, setHostDraftKeyId] = useState<string | null>(null);
  const clearHostDraft = useCallback(() => setHostDraftKeyId(null), []);
  const bumpRefresh = useCallback(() => setRefreshSignal((n) => n + 1), []);

  const loadEnv = useCallback(() => {
    call(api().env.info())
      .then(setEnv)
      .catch((e: unknown) => setError(errorData(e)));
  }, []);
  const loadAgent = useCallback(() => {
    call(api().agent.status())
      .then((st) => setAgent(st.state))
      .catch(() => setAgent('unknown'));
  }, []);

  useEffect(() => loadEnv(), [loadEnv, props.settings.sshDir, props.settings.binDir]);
  useEffect(() => {
    loadAgent();
    const timer = setInterval(loadAgent, 15_000);
    window.addEventListener('focus', loadAgent);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', loadAgent);
    };
  }, [loadAgent]);

  // Global shortcuts: Ctrl/Cmd+N new key (any page), F5 refresh the current page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isModKey(e) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setPage('keys');
        setGenerateOpen(true);
      } else if (e.key === 'F5') {
        e.preventDefault();
        setRefreshSignal((n) => n + 1);
        loadAgent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadAgent]);

  const addToAgent = (key: KeyInfo): void => {
    if (key.hasPassphrase) {
      setAgentPrompt(key);
      return;
    }
    call(api().agent.add(key.id))
      .then(() => {
        notify.success(t('detail.addedToAgent', { name: key.id }));
        bumpRefresh();
      })
      .catch((e: unknown) => setError(errorData(e)));
  };

  const renderPage = (): JSX.Element => {
    switch (page) {
      case 'keys':
        return (
          <KeysPage
            refreshSignal={refreshSignal}
            dialogOpen={generateOpen || agentPrompt !== null}
            onNewKey={() => setGenerateOpen(true)}
            onAddToAgent={addToAgent}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            settings={props.settings}
            env={env}
            onChanged={(next) => {
              props.onSettingsChanged(next);
              setRefreshSignal((n) => n + 1);
            }}
          />
        );
      case 'agent':
        return <AgentPage refreshSignal={refreshSignal} onAddToAgent={addToAgent} onStatusChanged={loadAgent} />;
      case 'config':
        return <ConfigPage refreshSignal={refreshSignal} draftKeyId={hostDraftKeyId} onDraftConsumed={clearHostDraft} />;
      case 'test':
        return <TestPage onNavigate={setPage} onKeysChanged={bumpRefresh} />;
    }
  };

  return (
    <div className={s.root}>
      <div className={s.main}>
        <Sidebar page={page} onNavigate={setPage} />
        <main className={s.content} data-testid={`page-${page}`}>
          {error ? (
            <div className={s.error}>
              <ErrorCard error={error} onDismiss={() => setError(null)} />
            </div>
          ) : null}
          {renderPage()}
        </main>
      </div>
      <StatusBar agent={agent} env={env} />
      <GenerateDialog
        open={generateOpen}
        defaultComment={env?.defaultComment ?? ''}
        onClose={() => setGenerateOpen(false)}
        onCreated={() => setRefreshSignal((n) => n + 1)}
        onAddToAgent={(k: KeyDetail) => addToAgent(k)}
        onCreateHost={(k: KeyDetail) => {
          setGenerateOpen(false);
          setHostDraftKeyId(k.id);
          setPage('config');
        }}
      />
      <AgentPassphraseDialog
        keyInfo={agentPrompt}
        onClose={() => setAgentPrompt(null)}
        onDone={() => {
          notify.success(t('detail.addedToAgent', { name: agentPrompt?.id ?? '' }));
          setAgentPrompt(null);
          bumpRefresh();
        }}
      />
      <Toaster toasterId={TOASTER_ID} position="bottom-end" />
    </div>
  );
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fatal, setFatal] = useState<SkmErrorData | null>(null);
  const systemDark = useSystemDark();

  useEffect(() => {
    call(api().settings.get())
      .then((st) => {
        setLanguage(st.language);
        setSettings(st);
      })
      .catch((e: unknown) => setFatal(errorData(e)));
  }, []);

  const dark = settings?.theme === 'dark' || (settings?.theme === 'system' && systemDark);
  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ height: '100vh' }} data-theme={dark ? 'dark' : 'light'}>
      {fatal ? <ErrorCard error={fatal} /> : null}
      {settings ? (
        <Shell
          key={settings.language}
          settings={settings}
          onSettingsChanged={(next) => {
            setLanguage(next.language);
            setSettings(next);
          }}
        />
      ) : null}
    </FluentProvider>
  );
}
