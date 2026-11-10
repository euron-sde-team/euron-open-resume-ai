# Test ids

Stable `data-testid` hooks for end-to-end tests. Prefer accessible names (roles and labels) where they exist; these ids cover elements without a unique accessible name. `<id>` marks a dynamic suffix (for example `case-action-<id>` is `case-action-hide`).

Generated from the source by `node scripts/gen-testids.mjs`; rerun it after adding or renaming an id.

## Shell and navigation

| Test id | Source |
|---|---|
| `avatar-menu` | `components/shell/avatar-menu.tsx` |
| `confirm-action` | `components/common/confirm-dialog.tsx` |
| `nav-admin` | `components/shell/avatar-menu.tsx` |
| `sign-out` | `components/shell/avatar-menu.tsx` |
| `theme-dark` | `components/shell/avatar-menu.tsx` |
| `theme-light` | `components/shell/avatar-menu.tsx` |
| `theme-system` | `components/shell/avatar-menu.tsx` |

## Sidebar

| Test id | Source |
|---|---|
| `account-menu` | `components/app/sidebar.tsx` |
| `nav-<id>` | `components/app/sidebar.tsx` |
| `sign-out` | `components/app/sidebar.tsx` |

## Settings

| Test id | Source |
|---|---|
| `usage-runs` | `components/settings/settings-view.tsx` |

## Sign up and sign in

| Test id | Source |
|---|---|
| `forgot-sent` | `components/auth/forgot-password.tsx` |
| `forgot-submit` | `components/auth/forgot-password.tsx` |
| `goodbye` | `components/auth/goodbye.tsx` |
| `login-submit` | `components/auth/login-form.tsx` |
| `recovery-code-input` | `components/auth/login-form.tsx` |
| `recovery-toggle` | `components/auth/login-form.tsx` |
| `reset-done` | `components/auth/reset-password.tsx` |
| `reset-submit` | `components/auth/reset-password.tsx` |
| `signup-check-email` | `components/auth/signup-form.tsx` |
| `signup-submit` | `components/auth/signup-form.tsx` |
| `totp-input` | `components/auth/login-form.tsx` |

## Account

| Test id | Source |
|---|---|
| `delete-account` | `components/account/privacy-section.tsx` |
| `delete-account-confirm` | `components/account/privacy-section.tsx` |
| `delete-account-dialog` | `components/account/privacy-section.tsx` |
| `delete-confirm-username` | `components/account/privacy-section.tsx` |
| `delete-password` | `components/account/privacy-section.tsx` |
| `delete-totp` | `components/account/privacy-section.tsx` |
| `export-data` | `components/account/privacy-section.tsx` |
| `password-save` | `components/account/security-section.tsx` |
| `recovery-codes` | `components/account/security-section.tsx` |
| `recovery-copy` | `components/account/security-section.tsx` |
| `recovery-done` | `components/account/security-section.tsx` |
| `recovery-download` | `components/account/security-section.tsx` |
| `recovery-saved` | `components/account/security-section.tsx` |
| `session-revoke` | `components/account/security-section.tsx` |
| `sessions-list` | `components/account/security-section.tsx` |
| `sessions-sign-out-all` | `components/account/security-section.tsx` |
| `totp-disable` | `components/account/security-section.tsx` |
| `totp-enable` | `components/account/security-section.tsx` |
| `totp-qr` | `components/account/security-section.tsx` |
| `totp-regenerate` | `components/account/security-section.tsx` |
| `totp-secret` | `components/account/security-section.tsx` |
| `totp-start` | `components/account/security-section.tsx` |

## Admin

| Test id | Source |
|---|---|
| `admin-back-to-app` | `components/admin/shell/admin-shell.tsx` |
| `admin-forbidden` | `components/admin/shell/forbidden.tsx` |
| `admin-menu` | `components/admin/shell/admin-shell.tsx` |
| `admin-nav` | `components/admin/shell/admin-shell.tsx` |
| `admin-nav-<id>` | `components/admin/shell/admin-shell.tsx` |
| `admin-product-name` | `components/admin/shell/admin-shell.tsx` |
| `admin-sidebar` | `components/admin/shell/admin-shell.tsx` |
| `admin-sidebar-toggle` | `components/admin/shell/admin-shell.tsx` |
| `audit-data` | `components/admin/pages/audit.tsx` |
| `audit-expand` | `components/admin/pages/audit.tsx` |
| `audit-list` | `components/admin/pages/audit.tsx` |
| `audit-more` | `components/admin/pages/audit.tsx` |
| `audit-row-<id>` | `components/admin/pages/audit.tsx` |
| `model-add` | `components/admin/pages/models.tsx` |
| `model-add-<id>` | `components/admin/pages/models.tsx` |
| `model-context` | `components/admin/pages/models.tsx` |
| `model-default` | `components/admin/pages/models.tsx` |
| `model-description` | `components/admin/pages/models.tsx` |
| `model-dialog` | `components/admin/pages/models.tsx` |
| `model-enabled` | `components/admin/pages/models.tsx` |
| `model-kind` | `components/admin/pages/models.tsx` |
| `model-max-output` | `components/admin/pages/models.tsx` |
| `model-name` | `components/admin/pages/models.tsx` |
| `model-provider` | `components/admin/pages/models.tsx` |
| `model-ref` | `components/admin/pages/models.tsx` |
| `model-save` | `components/admin/pages/models.tsx` |
| `model-sort` | `components/admin/pages/models.tsx` |
| `model-test-dialog` | `components/admin/pages/models.tsx` |
| `model-test-result` | `components/admin/pages/models.tsx` |
| `override-form` | `components/admin/pages/user-sheet.tsx` |
| `override-note` | `components/admin/pages/user-sheet.tsx` |
| `override-remove` | `components/admin/pages/user-sheet.tsx` |
| `override-resumes` | `components/admin/pages/user-sheet.tsx` |
| `override-runs` | `components/admin/pages/user-sheet.tsx` |
| `override-save` | `components/admin/pages/user-sheet.tsx` |
| `override-upload-mb` | `components/admin/pages/user-sheet.tsx` |
| `provider-add` | `components/admin/pages/models.tsx` |
| `provider-dialog` | `components/admin/pages/models.tsx` |
| `provider-enabled` | `components/admin/pages/models.tsx` |
| `provider-kind` | `components/admin/pages/models.tsx` |
| `provider-name` | `components/admin/pages/models.tsx` |
| `provider-save` | `components/admin/pages/models.tsx` |
| `provider-slug` | `components/admin/pages/models.tsx` |
| `provider-url` | `components/admin/pages/models.tsx` |
| `reason-confirm` | `components/admin/shell/reason-dialog.tsx` |
| `reason-days` | `components/admin/shell/reason-dialog.tsx` |
| `reason-input` | `components/admin/shell/reason-dialog.tsx` |
| `reason-typed` | `components/admin/shell/reason-dialog.tsx` |
| `settings-app-name` | `components/admin/pages/settings.tsx` |
| `settings-discard` | `components/admin/pages/settings.tsx` |
| `settings-domain-add` | `components/admin/pages/settings.tsx` |
| `settings-domain-input` | `components/admin/pages/settings.tsx` |
| `settings-domains` | `components/admin/pages/settings.tsx` |
| `settings-form` | `components/admin/pages/settings.tsx` |
| `settings-min-version` | `components/admin/pages/settings.tsx` |
| `settings-prompt` | `components/admin/pages/settings.tsx` |
| `settings-registration` | `components/admin/pages/settings.tsx` |
| `settings-save` | `components/admin/pages/settings.tsx` |
| `settings-save-bar` | `components/admin/pages/settings.tsx` |
| `settings-support-email` | `components/admin/pages/settings.tsx` |
| `settings-tagline` | `components/admin/pages/settings.tsx` |
| `tier-add` | `components/admin/pages/quotas.tsx` |
| `tier-default` | `components/admin/pages/quotas.tsx` |
| `tier-dialog` | `components/admin/pages/quotas.tsx` |
| `tier-menu-<id>` | `components/admin/pages/quotas.tsx` |
| `tier-name` | `components/admin/pages/quotas.tsx` |
| `tier-resumes` | `components/admin/pages/quotas.tsx` |
| `tier-runs` | `components/admin/pages/quotas.tsx` |
| `tier-save` | `components/admin/pages/quotas.tsx` |
| `tier-upload-mb` | `components/admin/pages/quotas.tsx` |
| `user-ban` | `components/admin/pages/user-sheet.tsx` |
| `user-erase` | `components/admin/pages/user-sheet.tsx` |
| `user-limits` | `components/admin/pages/user-sheet.tsx` |
| `user-make-admin` | `components/admin/pages/user-sheet.tsx` |
| `user-remove-admin` | `components/admin/pages/user-sheet.tsx` |
| `user-suspend` | `components/admin/pages/user-sheet.tsx` |
| `user-tier` | `components/admin/pages/user-sheet.tsx` |
| `user-unban` | `components/admin/pages/user-sheet.tsx` |
| `user-unsuspend` | `components/admin/pages/user-sheet.tsx` |
| `users-role` | `components/admin/pages/users.tsx` |
| `users-tier` | `components/admin/pages/users.tsx` |

## Pages

| Test id | Source |
|---|---|
| `<id>-generate` | `components/resume/report/on-demand.tsx` |
| `<id>-retry` | `components/resume/report/on-demand.tsx` |
| `<id>-working` | `components/resume/report/on-demand.tsx` |
| `analyse` | `components/resume/builder/builder-view.tsx` |
| `analysis-tab` | `components/resume/report/analysis-tab.tsx` |
| `builder-file-input` | `components/resume/builder/chat-panel.tsx` |
| `builder-preview` | `components/resume/builder/builder-view.tsx` |
| `chat-<id>` | `components/resume/builder/chat-panel.tsx` |
| `chat-input` | `components/resume/builder/chat-panel.tsx` |
| `chat-log` | `components/resume/builder/chat-panel.tsx` |
| `chat-send` | `components/resume/builder/chat-panel.tsx` |
| `chat-working` | `components/resume/builder/chat-panel.tsx` |
| `cover-letter-tab` | `components/resume/report/cover-letter-tab.tsx` |
| `download-cover-docx` | `components/resume/report/improved-tab.tsx` |
| `download-cover-pdf` | `components/resume/report/improved-tab.tsx` |
| `download-docx` | `components/resume/builder/builder-view.tsx`, `components/resume/report/improved-tab.tsx` |
| `download-menu` | `components/resume/builder/builder-view.tsx` |
| `download-pdf` | `components/resume/builder/builder-view.tsx`, `components/resume/report/improved-tab.tsx` |
| `draft-name` | `components/resume/builder/builder-view.tsx` |
| `draft-row` | `components/resume/builder/drafts-drawer.tsx` |
| `draft-save` | `components/resume/builder/builder-view.tsx` |
| `draft-state` | `components/resume/builder/builder-view.tsx` |
| `drafts-drawer` | `components/resume/builder/drafts-drawer.tsx` |
| `drafts-open` | `components/resume/builder/builder-view.tsx` |
| `dropzone` | `components/resume/upload-view.tsx` |
| `entry-builder` | `components/resume/resume-list.tsx` |
| `entry-upload` | `components/resume/resume-list.tsx` |
| `file-input` | `components/resume/upload-view.tsx` |
| `file-name` | `components/resume/upload-view.tsx` |
| `improved-tab` | `components/resume/report/improved-tab.tsx` |
| `interview-item` | `components/resume/report/extras-tabs.tsx` |
| `interview-tab` | `components/resume/report/extras-tabs.tsx` |
| `preview-frame` | `components/resume/preview-frame.tsx` |
| `project-idea` | `components/resume/report/extras-tabs.tsx` |
| `projects-tab` | `components/resume/report/extras-tabs.tsx` |
| `quota-exhausted` | `components/resume/quota-notice.tsx` |
| `quota-left` | `components/resume/quota-notice.tsx` |
| `report-error` | `components/resume/report/resume-report.tsx` |
| `report-progress` | `components/resume/report/resume-report.tsx` |
| `report-retry` | `components/resume/report/resume-report.tsx` |
| `report-score` | `components/resume/report/resume-report.tsx` |
| `report-title` | `components/resume/report/resume-report.tsx` |
| `resume-delete` | `components/resume/resume-list.tsx` |
| `resume-row` | `components/resume/resume-list.tsx` |
| `resume-score` | `components/resume/resume-list.tsx` |
| `resume-status` | `components/resume/resume-list.tsx` |
| `roadmap-tab` | `components/resume/report/extras-tabs.tsx` |
| `roadmap-view` | `components/resume/report/extras-tabs.tsx` |
| `sample-dialog` | `components/resume/samples-view.tsx` |
| `sample-row` | `components/resume/samples-view.tsx` |
| `sample-use` | `components/resume/samples-view.tsx` |
| `samples-count` | `components/resume/samples-view.tsx` |
| `samples-field` | `components/resume/samples-view.tsx` |
| `samples-list` | `components/resume/samples-view.tsx` |
| `samples-search` | `components/resume/samples-view.tsx` |
| `section-editor` | `components/resume/builder/section-editor.tsx` |
| `tailor-submit` | `components/resume/report/tailor-tab.tsx` |
| `tailor-tab` | `components/resume/report/tailor-tab.tsx` |
| `template-<id>` | `components/resume/template-chooser.tsx` |
| `template-dialog` | `components/resume/template-chooser.tsx` |
| `template-open` | `components/resume/template-chooser.tsx` |
| `upload-error` | `components/resume/upload-view.tsx` |
| `upload-problem` | `components/resume/upload-view.tsx` |
| `upload-submit` | `components/resume/upload-view.tsx` |
