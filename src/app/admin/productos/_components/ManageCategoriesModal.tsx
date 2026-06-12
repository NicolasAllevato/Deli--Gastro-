"use client";

import { Plus, Tag, Edit2, Trash2 } from "lucide-react";
import type { Category, Product } from "@/fixtures/productos";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface Props {
  categories: Category[];
  products: Product[];
  onClose: () => void;
  onAdd: () => void;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
}

export function ManageCategoriesModal({ categories, products, onClose, onAdd, onEdit, onDelete }: Props) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Administrar Categorías"
      description="Organiza tu menú"
      size="lg"
      footer={
        <Button leftIcon={<Plus size={16} />} onClick={onAdd}>
          Añadir Categoría
        </Button>
      }
    >
      <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-3">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500 font-bold">
            No hay categorías. Crea una nueva.
          </div>
        ) : (
          categories.map((category) => (
            <div
              key={category.id}
              className="neumorphic p-4 rounded-2xl flex items-center justify-between group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange shrink-0">
                  <Tag size={16} />
                </div>
                <div>
                  <h4 className="font-headline font-bold text-gray-800">{category.name}</h4>
                  <div className="flex items-center gap-3 mt-1.5">
                    <Badge tone={category.is_active ? "green" : "red"}>
                      {category.is_active ? "Activa" : "Inactiva"}
                    </Badge>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      {products.filter((p) => p.category_id === category.id).length} productos
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                <Button
                  variant="icon"
                  size="sm"
                  aria-label={`Editar ${category.name}`}
                  onClick={() => onEdit(category)}
                >
                  <Edit2 size={15} />
                </Button>
                <Button
                  variant="icon"
                  size="sm"
                  aria-label={`Eliminar ${category.name}`}
                  onClick={() => onDelete(category.id)}
                  className="hover:text-red-500"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
