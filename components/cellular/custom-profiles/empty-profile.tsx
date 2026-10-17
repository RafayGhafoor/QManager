import React from "react";
import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";

interface EmptyProfileProps {
  /** Opens the new-profile editor; the button renders only when given. */
  onAdd?: () => void;
}

const EmptyProfileComponent = ({ onAdd }: EmptyProfileProps) => {
  const { t } = useTranslation("cellular");
  return (
    <div className="flex flex-col items-center gap-4">
      <ConditionScreen
        tone="neutral"
        glyph="sim_card"
        ariaRole="status"
        title={t("custom_profiles.empty_state.title")}
        description={t("custom_profiles.empty_state.description_full")}
        className="w-full rounded-tile py-10"
      />
      {onAdd && (
        <Button size="action" onClick={onAdd}>
          <MaterialSymbol name="add" size={18} />
          {t("custom_profiles.registry.add")}
        </Button>
      )}
    </div>
  );
};

export default EmptyProfileComponent;
