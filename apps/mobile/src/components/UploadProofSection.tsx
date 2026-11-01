import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LeaveRequestDto } from "@employee-saas/shared";
import { Button } from "./ui/Button";
import { api, getApiOrigin } from "../lib/apiClient";
import { getErrorMessage } from "../lib/errorMapping";
import { formatDate } from "../lib/formatDate";
import { validateProofFile } from "../lib/fileValidation";
import { useLeaveDocuments } from "../lib/queries";
import {
  ProofPickerPermissionError,
  pickProofDocument,
  pickProofFromCamera,
  pickProofFromGallery,
  type PickedProofFile,
} from "../lib/proofUpload";
import { strings } from "../strings";

type ProofStatus = LeaveRequestDto["proofStatus"];

const UPLOADABLE_STATUSES: ProofStatus[] = ["MISSING", "INFO_REQUIRED", "REJECTED"];

export function UploadProofSection({ requestId, proofStatus }: { requestId: string; proofStatus: ProofStatus }) {
  const queryClient = useQueryClient();
  const documentsQuery = useLeaveDocuments(requestId);

  const uploadMutation = useMutation({
    mutationFn: (file: PickedProofFile) => {
      const formData = new FormData();
      formData.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
      return api.upload(`/leave-requests/${requestId}/documents`, formData);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-documents", requestId] }),
        queryClient.invalidateQueries({ queryKey: ["leave-request", requestId] }),
      ]);
      Alert.alert(strings.upload.title, strings.upload.success);
    },
    onError: (error) => Alert.alert(strings.common.somethingWentWrong, getErrorMessage(error)),
  });

  function handlePicked(file: PickedProofFile | null) {
    if (!file) return;
    const validationError = validateProofFile(file);
    if (validationError) {
      Alert.alert(strings.upload.title, strings.upload[validationError]);
      return;
    }
    uploadMutation.mutate(file);
  }

  async function runPicker(pick: () => Promise<PickedProofFile | null>) {
    try {
      handlePicked(await pick());
    } catch (error) {
      if (error instanceof ProofPickerPermissionError) {
        Alert.alert(strings.upload.title, strings.upload.permissionDenied);
        return;
      }
      Alert.alert(strings.common.somethingWentWrong, getErrorMessage(error));
    }
  }

  function openUploadMenu() {
    Alert.alert(strings.upload.title, strings.upload.limits, [
      { text: strings.upload.takePhoto, onPress: () => runPicker(pickProofFromCamera) },
      { text: strings.upload.choosePhoto, onPress: () => runPicker(pickProofFromGallery) },
      { text: strings.upload.chooseFile, onPress: () => runPicker(pickProofDocument) },
      { text: strings.common.cancel, style: "cancel" },
    ]);
  }

  async function openDocument(docId: string) {
    try {
      const { url } = await api.get<{ url: string }>(`/leave-requests/${requestId}/documents/${docId}/download`);
      const fullUrl = url.startsWith("http") ? url : `${getApiOrigin()}${url}`;
      await WebBrowser.openBrowserAsync(fullUrl);
    } catch (error) {
      Alert.alert(strings.common.somethingWentWrong, getErrorMessage(error));
    }
  }

  const canUpload = UPLOADABLE_STATUSES.includes(proofStatus);
  const uploadLabel = proofStatus === "MISSING" ? strings.leaveDetail.uploadNow : strings.leaveDetail.uploadAnother;
  const documents = documentsQuery.data ?? [];

  return (
    <View>
      <Text style={styles.cardTitle}>{strings.leaveDetail.documents}</Text>
      {documents.length === 0 ? (
        <Text style={styles.muted}>{strings.leaveDetail.noDocuments}</Text>
      ) : (
        documents.map((doc) => (
          <Pressable key={doc.id} onPress={() => openDocument(doc.id)} style={styles.docRow}>
            <Text style={styles.docName}>{doc.filename}</Text>
            <Text style={styles.muted}>{formatDate(doc.uploadedAt)}</Text>
            <Text style={styles.docStatus}>{strings.documentStatus[doc.status]}</Text>
            {doc.reviewNote ? (
              <Text style={styles.muted}>
                {strings.leaveDetail.reviewNote}: "{doc.reviewNote}"
              </Text>
            ) : null}
          </Pressable>
        ))
      )}
      {canUpload ? (
        <View style={styles.uploadButton}>
          <Button
            title={uploadMutation.isPending ? strings.upload.uploading : uploadLabel}
            loading={uploadMutation.isPending}
            onPress={openUploadMenu}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  docRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  docName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  docStatus: { fontSize: 13, fontWeight: "600", color: "#111827", marginTop: 2 },
  uploadButton: { marginTop: 12 },
});
