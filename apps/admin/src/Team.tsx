import { errorMessageKey, useApi, useQuery } from '@oregano/app-core';
import { t } from '@oregano/i18n';

/** Read only. Roles are granted and revoked by an operator on the command line, never from this page. */
export function Team() {
  const api = useApi();
  const team = useQuery({ queryKey: ['admin', 'team'], queryFn: () => api.team() });
  return (
    <>
      <h1>Team</h1>
      <p className="muted">{t('en', 'admin.teamNote')}</p>
      {team.isError ? <p role="alert">{t('en', errorMessageKey(team.error))}</p> : null}
      <table>
        <thead>
          <tr>
            {['Name', 'Phone', 'Role', 'Since'].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(team.data ?? []).map((member) => (
            <tr key={member.userId}>
              <td>{member.name ?? '—'}</td>
              <td>{member.phone}</td>
              <td>{member.role}</td>
              <td>{new Date(member.grantedAt).toLocaleDateString('en-GB')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
