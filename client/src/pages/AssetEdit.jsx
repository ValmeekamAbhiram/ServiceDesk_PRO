/**
 * ServiceDesk Pro — add or edit an asset.
 *
 * One form for both, because the fields are identical and two copies would drift. The
 * only real differences are the two the server insists on: `tag` is generated on create
 * and never sent, and `version` is required on update so the slower of two admins
 * editing the same laptop is told rather than silently overwritten.
 *
 * Empty text boxes are sent as `null`, not `''`. The unique index on `serialNumber` is
 * partial on `{ $type: 'string' }`, so a stored empty string is a value — two assets
 * saved with a blank serial box would collide.
 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { AssetStatus, AssetType } from '@shared/enums';
import { ASSET_STATUS_META, ASSET_TYPE_META } from '@shared/labels';
import { useAsset, useCreateAsset, useUpdateAsset } from '@/api/assets';
import { useUsers } from '@/api/users';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { applyServerErrors } from '@/lib/form';
import { toast } from '@/stores/toast.store';
/** `''` means "not given" in a text input; the mapper below turns it into `null`. */
const optionalText = (max) => z.string().trim().max(max).optional();
const schema = z.object({
    name: z.string().trim().min(2, 'Give the asset a name.').max(160, 'That name is too long.'),
    type: z.nativeEnum(AssetType),
    status: z.nativeEnum(AssetStatus),
    serialNumber: optionalText(120),
    manufacturer: optionalText(80),
    model: optionalText(120),
    location: optionalText(120),
    assignedToId: z.string().optional(),
    purchaseDate: z.string().optional(),
    purchaseCost: z.string().optional(),
    warrantyExpiryDate: z.string().optional(),
    notes: optionalText(2000),
});
const FIELDS = [
    'name', 'type', 'status', 'serialNumber', 'manufacturer', 'model', 'location',
    'assignedToId', 'purchaseDate', 'purchaseCost', 'warrantyExpiryDate', 'notes',
];
const EMPTY = {
    name: '',
    type: AssetType.LAPTOP,
    status: AssetStatus.IN_STOCK,
    serialNumber: '',
    manufacturer: '',
    model: '',
    location: '',
    assignedToId: '',
    purchaseDate: '',
    purchaseCost: '',
    warrantyExpiryDate: '',
    notes: '',
};
/** `<input type="date">` wants `YYYY-MM-DD`; the DTO carries a full ISO timestamp. */
const asDateInput = (iso) => (iso ? iso.slice(0, 10) : '');
/** Blank stays blank rather than becoming `null`, so a create sends nothing at all. */
const orNull = (value) => value === undefined ? undefined : value.trim() === '' ? null : value.trim();
function toPayload(values) {
    return {
        name: values.name,
        type: values.type,
        status: values.status,
        serialNumber: orNull(values.serialNumber),
        manufacturer: orNull(values.manufacturer),
        model: orNull(values.model),
        location: orNull(values.location),
        assignedToId: values.assignedToId ? values.assignedToId : null,
        purchaseDate: orNull(values.purchaseDate),
        /* `Number('')` is 0, which would record a free laptop. Guarded before conversion. */
        purchaseCost: values.purchaseCost?.trim() ? Number(values.purchaseCost) : null,
        warrantyExpiryDate: orNull(values.warrantyExpiryDate),
        notes: orNull(values.notes),
    };
}
export default function AssetEdit() {
    const { id } = useParams();
    const editing = Boolean(id);
    const navigate = useNavigate();
    const existing = useAsset(id);
    const create = useCreateAsset();
    const update = useUpdateAsset(id ?? '');
    /* Anyone can hold an asset, so this is the whole directory rather than the assignee
     * list — which is technicians only. The page is behind `ASSET_MANAGE`, an admin
     * permission, and admins hold `USER_READ`. */
    const users = useUsers({ page: 1, limit: 200, sortBy: 'name', sortOrder: 'asc' });
    const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
    /* Reset rather than `defaultValues`: the record arrives after the first render, and
     * `defaultValues` is only read once. */
    useEffect(() => {
        const asset = existing.data;
        if (!asset)
            return;
        form.reset({
            name: asset.name,
            type: asset.type,
            status: asset.status,
            serialNumber: asset.serialNumber ?? '',
            manufacturer: asset.manufacturer ?? '',
            model: asset.model ?? '',
            location: asset.location ?? '',
            assignedToId: asset.assignedTo?.id ?? '',
            purchaseDate: asDateInput(asset.purchaseDate),
            purchaseCost: asset.purchaseCost === null ? '' : String(asset.purchaseCost),
            warrantyExpiryDate: asDateInput(asset.warrantyExpiryDate),
            notes: asset.notes ?? '',
        });
    }, [existing.data, form]);
    const submit = form.handleSubmit(async (values) => {
        try {
            const payload = toPayload(values);
            const saved = editing
                ? await update.mutateAsync({ ...payload, version: existing.data?.version ?? 0 })
                : await create.mutateAsync(payload);
            toast.success(editing ? 'Saved.' : `${saved.tag} registered.`);
            navigate(`/assets/${saved.id}`, { replace: true });
        }
        catch (error) {
            const banner = applyServerErrors(error, form, FIELDS);
            if (banner)
                toast.error(banner);
        }
    });
    if (editing && existing.isLoading) {
        return <Skeleton className="h-96 w-full"/>;
    }
    const err = form.formState.errors;
    return (<div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to={editing ? `/assets/${id}` : '/assets'} className="btn btn-ghost btn-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
          Back
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-ink">
            {editing ? existing.data?.name : 'Add an asset'}
          </h1>
          <p className="text-xs text-ink-subtle">
            {editing
            ? `Asset tag ${existing.data?.tag ?? ''}`
            : 'The asset tag is generated when you save.'}
          </p>
        </div>
      </div>

      <Card>
        <CardBody>
          <form className="space-y-4" onSubmit={submit} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required error={err.name?.message}>
                <Input id="name" invalid={Boolean(err.name)} {...form.register('name')}/>
              </Field>
              <Field label="Type" htmlFor="type" required error={err.type?.message}>
                <Select id="type" {...form.register('type')}>
                  {Object.values(AssetType).map((value) => (<option key={value} value={value}>
                      {ASSET_TYPE_META[value].label}
                    </option>))}
                </Select>
              </Field>
              <Field label="Status" htmlFor="status" required error={err.status?.message}>
                <Select id="status" {...form.register('status')}>
                  {Object.values(AssetStatus).map((value) => (<option key={value} value={value}>
                      {ASSET_STATUS_META[value].label}
                    </option>))}
                </Select>
              </Field>
              <Field label="Assigned to" htmlFor="assignedToId" hint="Leave blank to keep it on the shelf." error={err.assignedToId?.message}>
                <Select id="assignedToId" {...form.register('assignedToId')}>
                  <option value="">Nobody</option>
                  {(users.data?.items ?? []).map((user) => (<option key={user.id} value={user.id}>
                      {user.name}
                    </option>))}
                </Select>
              </Field>
              <Field label="Manufacturer" htmlFor="manufacturer" error={err.manufacturer?.message}>
                <Input id="manufacturer" {...form.register('manufacturer')}/>
              </Field>
              <Field label="Model" htmlFor="model" error={err.model?.message}>
                <Input id="model" {...form.register('model')}/>
              </Field>
              <Field label="Serial number" htmlFor="serialNumber" hint="Must be unique if given." error={err.serialNumber?.message}>
                <Input id="serialNumber" {...form.register('serialNumber')}/>
              </Field>
              <Field label="Location" htmlFor="location" error={err.location?.message}>
                <Input id="location" {...form.register('location')}/>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Purchased" htmlFor="purchaseDate" error={err.purchaseDate?.message}>
                <Input id="purchaseDate" type="date" {...form.register('purchaseDate')}/>
              </Field>
              <Field label="Cost (₹)" htmlFor="purchaseCost" error={err.purchaseCost?.message}>
                <Input id="purchaseCost" type="number" min={0} step="0.01" {...form.register('purchaseCost')}/>
              </Field>
              <Field label="Warranty expires" htmlFor="warrantyExpiryDate" error={err.warrantyExpiryDate?.message}>
                <Input id="warrantyExpiryDate" type="date" {...form.register('warrantyExpiryDate')}/>
              </Field>
            </div>

            <Field label="Notes" htmlFor="notes" error={err.notes?.message}>
              <Textarea id="notes" rows={4} {...form.register('notes')}/>
            </Field>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button type="submit" loading={create.isPending || update.isPending}>
                {editing ? 'Save changes' : 'Register asset'}
              </Button>
              <Link to={editing ? `/assets/${id}` : '/assets'} className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>);
}
