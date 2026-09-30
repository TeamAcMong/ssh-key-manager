import { useState } from 'react';
import { Button, Dropdown, Field, Input, MessageBar, MessageBarBody, Option, Radio, RadioGroup, Text, Title3, makeStyles, tokens } from '@fluentui/react-components';
import { Folder20Regular } from '@fluentui/react-icons';
import type { EnvInfo, Language, Settings, SkmErrorData, ThemeSetting } from '../../core/types';
import { t } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { ErrorCard, useNotify } from '../components/common';

const useStyles = makeStyles({
  page: { padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxWidth: '760px', overflow: 'auto', height: '100%', boxSizing: 'border-box' },
  row: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  grow: { flexGrow: 1, minWidth: 0 },
  lang: { width: '200px' }
});

export function SettingsPage(props: { settings: Settings; env: EnvInfo | null; onChanged: (s: Settings) => void }): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [error, setError] = useState<SkmErrorData | null>(null);
  const { settings, env } = props;

  const save = async (patch: Partial<Pick<Settings, 'sshDir' | 'binDir' | 'theme' | 'language'>>): Promise<void> => {
    setError(null);
    try {
      const next = await call(api().settings.set(patch));
      props.onChanged(next);
      notify.success(t('settings.saved'));
    } catch (e) {
      setError(errorData(e));
    }
  };

  const pick = async (kind: 'ssh' | 'bin'): Promise<void> => {
    try {
      const dir = await call(api().settings.pickDir(kind));
      if (dir) await save(kind === 'ssh' ? { sshDir: dir } : { binDir: dir });
    } catch (e) {
      setError(errorData(e));
    }
  };

  return (
    <div className={s.page} data-testid="settings-page">
      <Title3>{t('settings.title')}</Title3>
      {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}

      <Field label={t('settings.sshDir')} hint={t('settings.sshDirHint')}>
        <div className={s.row}>
          <Input className={s.grow} readOnly value={settings.sshDir} data-testid="settings-sshdir" />
          <Button icon={<Folder20Regular />} onClick={() => void pick('ssh')}>
            {t('settings.pick')}
          </Button>
        </div>
      </Field>
      {env && !env.isSandbox && env.devMode ? (
        <MessageBar intent="warning" data-testid="real-dir-warning">
          <MessageBarBody>{t('settings.realDirWarn')}</MessageBarBody>
        </MessageBar>
      ) : null}

      <Field label={t('settings.bin')}>
        <div className={s.row}>
          <Input className={s.grow} readOnly value={settings.binDir ?? t('settings.binAuto')} />
          <Button icon={<Folder20Regular />} onClick={() => void pick('bin')}>
            {t('settings.pick')}
          </Button>
          <Button disabled={settings.binDir === null} onClick={() => void save({ binDir: null })}>
            {t('settings.binAuto')}
          </Button>
        </div>
      </Field>
      <Text size={200}>
        {t('settings.version')}: {env?.opensshVersion ?? t('status.openssh.unknown')}
      </Text>

      <Field label={t('settings.theme')}>
        <RadioGroup layout="horizontal" value={settings.theme} onChange={(_e, d) => void save({ theme: d.value as ThemeSetting })}>
          <Radio value="system" label={t('settings.theme.system')} />
          <Radio value="light" label={t('settings.theme.light')} data-testid="theme-light" />
          <Radio value="dark" label={t('settings.theme.dark')} data-testid="theme-dark" />
        </RadioGroup>
      </Field>

      <Field label={t('settings.language')}>
        <Dropdown className={s.lang} value={settings.language === 'vi' ? 'Tiếng Việt' : 'English'} selectedOptions={[settings.language]} onOptionSelect={(_e, d) => void save({ language: d.optionValue as Language })}>
          <Option value="vi">Tiếng Việt</Option>
          <Option value="en">English</Option>
        </Dropdown>
      </Field>
    </div>
  );
}
