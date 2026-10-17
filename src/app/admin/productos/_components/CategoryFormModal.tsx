"use client";

import { parsePoints } from "@/lib/catalog/points";
import { useState } from "react";
import type { Category } from "@/types/catalog";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";

interface Props {
  editingCategory: Category | null;
  onClose: () => void;
  onSubmit: (category: Category) => void;
}

export function CategoryFormModal({ editingCategory, onClose, onSubmit }: Props) {
  const [isActive, setIsActive] = useState(editingCategory ? editingCategory.is_active : true);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      id:          editingCategory?.id ?? crypto.randomUUID(),
      name:        fd.get("name") as string,
      description: fd.get("description") as string,
      is_active:   isActive,
      points_per_100: parsePoints(fd.get("points_per_100")),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editingCategory ? "Editar Categoría" : "Nueva Categoría"}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="category-form">
            Guardar
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={handleSubmit} className="space-y-5">
        <Field
          label="Nombre"
          name="name"
          type="text"
          required
          placeholder="Ej. Bebidas"
          defaultValue={editingCategory?.name}
        />
        <Field
          as="textarea"
          label="Descripción (opcional)"
          name="description"
          rows={3}
          placeholder="Descripción de la categoría"
          defaultValue={editingCategory?.description}
        />
        <Field
          label="Puntos por cada $100"
          name="points_per_100"
          type="number"
          step="0.1"
          min="0"
          placeholder="Vacío = esta categoría no da puntos"
          defaultValue={editingCategory?.points_per_100 ?? undefined}
        />
        <div className="neumorphic-inset rounded-xl px-4 py-3.5">
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label="Categoría activa"
          />
        </div>
      </form>
    </Modal>
  );
}
