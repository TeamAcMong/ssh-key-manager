import type { ReactElement } from 'react';
import { Badge, Text, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { DocumentText20Regular, Key20Regular, PlugConnected20Regular, Settings20Regular, ShieldKeyhole20Regular } from '@fluentui/react-icons';
import type { AgentServiceState, EnvInfo } from '../../core/types';
import { t, type MessageKey } from '../i18n/t';

export type PageId = 'keys' | 'agent' | 'config' | 'test' | 'settings';

const NAV: { id: PageId; label: MessageKey; icon: ReactElement }[] = [
  { id: 'keys', label: 'nav.keys', icon: <Key20Regular /> },
  { id: 'agent', label: 'nav.agent', icon: <ShieldKeyhole20Regular /> },
  { id: 'config', label: 'nav.config', icon: <DocumentText20Regular /> },
  { id: 'test', label: 'nav.test', icon: <PlugConnected20Regular /> }
];

const useStyles = makeStyles({
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    width: '184px',
    flexShrink: 0,
    boxSizing: 'border-box'
  },
  brand: { padding: `0 ${tokens.spacingHorizontalS} ${tokens.spacingVerticalM}`, fontWeight: tokens.fontWeightSemibold },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    border: 'none',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    textAlign: 'left',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover, color: tokens.colorNeutralForeground1 }
  },
  active: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: `inset 3px 0 0 ${tokens.colorBrandForeground1}`
  },
  spacer: { flexGrow: 1 },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: '28px',
    overflow: 'hidden',
    whiteSpace: 'nowrap'
  },
  statusItem: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, minWidth: 0 },
  path: { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }
});

export function Sidebar(props: { page: PageId; onNavigate: (p: PageId) => void }): JSX.Element {
  const s = useStyles();
  const item = (id: PageId, label: MessageKey, icon: ReactElement): JSX.Element => (
    <button
      key={id}
      className={mergeClasses(s.item, props.page === id && s.active)}
      aria-current={props.page === id ? 'page' : undefined}
      data-testid={`nav-${id}`}
      onClick={() => props.onNavigate(id)}
    >
      {icon}
      <span>{t(label)}</span>
    </button>
  );
  return (
    <nav className={s.nav} aria-label="Điều hướng">
      <Text className={s.brand}>{t('app.title')}</Text>
      {NAV.map((n) => item(n.id, n.label, n.icon))}
      <div className={s.spacer} />
      {item('settings', 'nav.settings', <Settings20Regular />)}
    </nav>
  );
}

const AGENT_COLOR: Record<AgentServiceState, 'success' | 'informative' | 'danger' | 'warning'> = {
  running: 'success',
  stopped: 'informative',
  disabled: 'danger',
  'not-installed': 'danger',
  unknown: 'warning'
};

export function StatusBar(props: { agent: AgentServiceState | null; env: EnvInfo | null }): JSX.Element {
  const s = useStyles();
  const agent = props.agent ?? 'unknown';
  return (
    <footer className={s.status} data-testid="status-bar">
      <span className={s.statusItem}>
        <Text size={200}>{t('status.agent')}:</Text>
        <Badge appearance="filled" color={AGENT_COLOR[agent]} size="small" data-testid="agent-badge">
          {t(`status.agent.${agent}` as MessageKey)}
        </Badge>
      </span>
      <Text size={200}>{props.env?.opensshVersion ?? t('status.openssh.unknown')}</Text>
      <span className={s.statusItem}>
        <Badge appearance="tint" color={props.env?.isSandbox ? 'informative' : 'warning'} size="small">
          {props.env?.isSandbox ? t('status.sandbox') : t('status.realDir')}
        </Badge>
        <Tooltip content={props.env?.sshDir ?? ''} relationship="description">
          <Text size={200} className={s.path}>
            {props.env?.sshDir}
          </Text>
        </Tooltip>
      </span>
    </footer>
  );
}
