import type { NumberingProfile } from "../../db/schema.ts";
import { hasSequenceToken } from "../../domain/numbering.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { NumberingProfileForm } from "./components/numbering-profile-form.tsx";
import type { NumberingProfileFormValues } from "./numbering.view.ts";

export function NumberingProfilesPage({
  profiles,
}: {
  profiles: NumberingProfile[];
}) {
  return (
    <div>
      <PageHeader
        title="Numbering profiles"
        description="Reusable invoice number formats and sequence reset rules."
        actions={
          <a href="/settings/numbering/new" class="btn btn-primary btn-sm">
            New profile
          </a>
        }
      />

      <div class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Name</th>
              <th>Pattern</th>
              <th>Reset</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr>
                <td class="font-medium">{profile.name}</td>
                <td class="font-mono text-xs">{profile.pattern}</td>
                <td>{profile.resetPeriod}</td>
                <td class="text-right">
                  {!hasSequenceToken(profile.pattern) ? (
                    <span class="badge badge-warning badge-sm mr-2">
                      no sequence
                    </span>
                  ) : null}
                  <a
                    href={`/settings/numbering/${profile.id}/edit`}
                    class="btn btn-ghost btn-xs"
                  >
                    Edit
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NewNumberingProfilePage({
  values,
}: {
  values: NumberingProfileFormValues;
}) {
  return (
    <div>
      <PageHeader title="New numbering profile" />
      <div class="app-card lift-enter max-w-2xl rounded-lg p-6">
        <NumberingProfileForm
          action="/settings/numbering"
          values={values}
          submitLabel="Create profile"
        />
      </div>
    </div>
  );
}

export function EditNumberingProfilePage({
  profile,
  values,
}: {
  profile: NumberingProfile;
  values: NumberingProfileFormValues;
}) {
  return (
    <div>
      <PageHeader
        title={profile.name}
        description="Edit numbering pattern and reset period."
        actions={
          <a href="/settings/numbering" class="btn btn-ghost btn-sm">
            Back to profiles
          </a>
        }
      />
      <div class="app-card lift-enter max-w-2xl rounded-lg p-6">
        <NumberingProfileForm
          action={`/settings/numbering/${profile.id}`}
          values={values}
          submitLabel="Save profile"
        />
      </div>
    </div>
  );
}
