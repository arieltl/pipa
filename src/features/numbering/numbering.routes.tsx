import { Hono, type Context } from "hono";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import type { FieldErrors } from "../../web/components/forms.tsx";
import type { FormBody } from "../../web/form-values.ts";
import { NumberingProfileForm } from "./components/numbering-profile-form.tsx";
import {
  EditNumberingProfilePage,
  NewNumberingProfilePage,
  NumberingProfilesPage,
} from "./numbering.pages.tsx";
import { numberingProfileFormSchema } from "./numbering.schema.ts";
import {
  createProfile,
  getProfile,
  listProfiles,
  updateProfile,
} from "./numbering.service.ts";
import {
  emptyNumberingProfileFormValues,
  numberingProfileFormValuesFromBody,
  numberingProfileFormValuesFromRow,
} from "./numbering.view.ts";

export const numberingRoutes = new Hono();

numberingRoutes.get("/", (c) =>
  c.render(<NumberingProfilesPage profiles={listProfiles()} />, {
    title: "Numbering profiles",
  }),
);

numberingRoutes.get("/new", (c) =>
  c.render(
    <NewNumberingProfilePage values={emptyNumberingProfileFormValues()} />,
    { title: "New numbering profile" },
  ),
);

numberingRoutes.post("/", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = numberingProfileFormSchema.safeParse(body);
  if (!parsed.success) {
    return renderProfileFormError(
      c,
      "/settings/numbering",
      body,
      fieldErrorsFromZod(parsed.error),
    );
  }

  const profile = createProfile(parsed.data);
  c.header("HX-Redirect", `/settings/numbering/${profile.id}/edit`);
  return c.body(null, 201);
});

numberingRoutes.get("/:id/edit", (c) => {
  const profile = getProfileFromParam(c.req.param("id"));
  if (!profile) return c.notFound();
  return c.render(
    <EditNumberingProfilePage
      profile={profile}
      values={numberingProfileFormValuesFromRow(profile)}
    />,
    { title: profile.name },
  );
});

numberingRoutes.post("/:id", async (c) => {
  const profile = getProfileFromParam(c.req.param("id"));
  if (!profile) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = numberingProfileFormSchema.safeParse(body);
  const action = `/settings/numbering/${profile.id}`;
  if (!parsed.success) {
    return renderProfileFormError(
      c,
      action,
      body,
      fieldErrorsFromZod(parsed.error),
    );
  }

  const updated = updateProfile(profile.id, parsed.data);
  return c.html(
    <NumberingProfileForm
      action={action}
      values={numberingProfileFormValuesFromRow(updated)}
      submitLabel="Save profile"
      saved
    />,
  );
});

function getProfileFromParam(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getProfile(id);
}

function renderProfileFormError(
  c: Context,
  action: string,
  body: FormBody,
  errors: FieldErrors,
) {
  c.status(422);
  return c.html(
    <NumberingProfileForm
      action={action}
      values={numberingProfileFormValuesFromBody(body)}
      errors={errors}
      submitLabel={action === "/settings/numbering" ? "Create profile" : "Save profile"}
    />,
  );
}
