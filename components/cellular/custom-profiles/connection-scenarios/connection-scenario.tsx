"use client";

import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import ConnectionScenariosCard from "./connection-scenario-card";

const ConnectionScenariosComponent = () => {
  const { t } = useTranslation("cellular");

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("scenarios.page.title")}
        description={t("scenarios.page.description")}
      />
      <ConnectionScenariosCard />
    </div>
  );
};

export default ConnectionScenariosComponent;
