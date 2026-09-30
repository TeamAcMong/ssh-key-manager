import { useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  Text,
  Toast,
  ToastTitle,
  Tooltip,
  makeStyles,
  tokens,
  useToastController
} from '@fluentui/react-components';
import { Copy20Regular, Dismiss16Regular, Eye20Regular, EyeOff20Regular } from '@fluentui/react-icons';
import type { SkmErrorData } from '../../core/types';
import { t, type MessageKey } from '../i18n/t';
import { passphraseStrength } from '../lib/strength';
import { api, call, errorData } from '../lib/api';

export const TOASTER_ID = 'skm-toaster';

const useStyles = makeStyles({
  pre: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    margin: 0,
    maxHeight: '160px',
    overflow: 'auto'
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXXL,
    textAlign: 'center',
    color: tokens.colorNeutralForeground2,
    height: '100%',
    boxSizing: 'border-box'
  },
  meter: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  meterBar: { flexGrow: 1 }
});

export function useNotify(): { success: (msg: string) => void } {
  const { dispatchToast } = useToastController(TOASTER_ID);
  return {
    success: (msg) =>
      dispatchToast(
        <Toast>
          <ToastTitle>{msg}</ToastTitle>
        </Toast>,
        { intent: 'success', timeout: 3000 }
      )
  };
}

/** Inline error: Vietnamese explanation, optional fix action, raw (redacted) stderr on demand. */
export function ErrorCard(props: { error: SkmErrorData; onDismiss?: () => void; action?: ReactNode }): JSX.Element {
  const s = useStyles();
  const { error } = props;
  return (
    <MessageBar intent="error" layout="multiline" data-testid="error-card">
      <MessageBarBody>
        <MessageBarTitle>{error.messageVi}</MessageBarTitle>
        {error.detail ? (
          <Accordion collapsible>
            <AccordionItem value="d">
              <AccordionHeader size="small">{t('common.techDetails')}</AccordionHeader>
              <AccordionPanel>
                <pre className={s.pre}>{error.detail}</pre>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        ) : null}
      </MessageBarBody>
      <MessageBarActions
        containerAction={props.onDismiss ? <Button appearance="transparent" icon={<Dismiss16Regular />} aria-label={t('common.close')} onClick={props.onDismiss} /> : undefined}
      >
        {props.action}
      </MessageBarActions>
    </MessageBar>
  );
}

export function EmptyState(props: { icon: ReactNode; title?: string; body?: string; action?: ReactNode }): JSX.Element {
  const s = useStyles();
  return (
    <div className={s.empty} data-testid="empty-state">
      {props.icon}
      {props.title ? (
        <Text weight="semibold" size={400}>
          {props.title}
        </Text>
      ) : null}
      {props.body ? <Text>{props.body}</Text> : null}
      {props.action}
    </div>
  );
}

/** Masked input with a show/hide toggle. The parent owns (and clears) the value. */
export function PassphraseField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  validationMessage?: string;
  validationState?: 'error' | 'warning' | 'success' | 'none';
  autoFocus?: boolean;
  testId?: string;
}): JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={props.label} validationMessage={props.validationMessage} validationState={props.validationState}>
      <Input
        type={visible ? 'text' : 'password'}
        value={props.value}
        autoFocus={props.autoFocus}
        autoComplete="new-password"
        spellCheck={false}
        data-testid={props.testId}
        onChange={(_e, d) => props.onChange(d.value)}
        contentAfter={
          <Tooltip content={visible ? t('common.hide') : t('common.show')} relationship="label">
            <Button appearance="transparent" size="small" icon={visible ? <EyeOff20Regular /> : <Eye20Regular />} onClick={() => setVisible((x) => !x)} />
          </Tooltip>
        }
      />
    </Field>
  );
}

export function StrengthMeter(props: { value: string }): JSX.Element | null {
  const s = useStyles();
  if (!props.value) return null;
  const level = passphraseStrength(props.value);
  const color = level <= 1 ? 'error' : level === 2 ? 'warning' : 'success';
  return (
    <div className={s.meter} data-testid="strength">
      <ProgressBar className={s.meterBar} value={(level + 1) / 5} color={color} thickness="large" />
      <Text size={200}>{t(`strength.${level}` as MessageKey)}</Text>
    </div>
  );
}

export function Mono(props: { children: ReactNode; testId?: string; unbounded?: boolean }): JSX.Element {
  const s = useStyles();
  return (
    <pre className={s.pre} style={props.unbounded ? { maxHeight: 'none', overflow: 'visible' } : undefined} data-testid={props.testId}>
      {props.children}
    </pre>
  );
}

/** Copies non-secret text through main (which refuses private key material). */
export function CopyTextButton(props: { text: string; onError: (e: SkmErrorData) => void; label?: string }): JSX.Element {
  const notify = useNotify();
  return (
    <Tooltip content={props.label ?? t('common.copy')} relationship="label">
      <Button
        size="small"
        icon={<Copy20Regular />}
        onClick={() => {
          call(api().clipboard.copyText(props.text))
            .then(() => notify.success(t('common.copied')))
            .catch((e: unknown) => props.onError(errorData(e)));
        }}
      />
    </Tooltip>
  );
}
