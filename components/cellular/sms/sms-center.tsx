"use client";

import { useTranslation } from "react-i18next";
import SmsInboxCard from "./sms-inbox-card";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { useSms } from "@/hooks/use-sms";
import SmsStorageCard from "./sms-storage-card";
import { useSmsStorage } from "@/hooks/use-sms-storage";

const SmsCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSaving,
    error,
    sendSms,
    deleteSms,
    deleteAllSms,
    refresh,
  } = useSms();
  const storage = useSmsStorage();

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("sms.page.title")}
        description={t("sms.page.description")}
      />
      <SmsInboxCard
        data={data}
        isLoading={isLoading}
        isSaving={isSaving}
        error={error}
        onSend={sendSms}
        onDelete={deleteSms}
        onDeleteAll={deleteAllSms}
        onRefresh={() => refresh()}
      />
      <SmsStorageCard store={storage} />
    </div>
  );
};

export default SmsCenterComponent;
