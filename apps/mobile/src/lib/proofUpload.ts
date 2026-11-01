import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export type PickedProofFile = { uri: string; name: string; mimeType: string; sizeBytes: number };

export class ProofPickerPermissionError extends Error {}

// Base64 has no exact byte-length field of its own, so this derives one from
// the encoded string length (4 base64 chars encode 3 bytes, minus `=` padding).
function base64SizeBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// Resizes to a max width and recompresses as JPEG so a phone photo (often
// several MB straight off the camera) lands well under the 5 MB proof limit
// before validateProofFile even runs. base64:true is requested purely to
// read back the compressed size - the upload itself uses saveAsync's uri.
async function compressImage(uri: string): Promise<{ uri: string; sizeBytes: number }> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
  const result = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  return { uri: result.uri, sizeBytes: result.base64 ? base64SizeBytes(result.base64) : 0 };
}

async function toProofFile(uri: string): Promise<PickedProofFile> {
  const compressed = await compressImage(uri);
  return {
    uri: compressed.uri,
    name: `proof-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: compressed.sizeBytes,
  };
}

export async function pickProofFromCamera(): Promise<PickedProofFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new ProofPickerPermissionError();
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  return toProofFile(result.assets[0].uri);
}

export async function pickProofFromGallery(): Promise<PickedProofFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ProofPickerPermissionError();
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  return toProofFile(result.assets[0].uri);
}

export async function pickProofDocument(): Promise<PickedProofFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/jpeg", "image/png", "application/pdf"],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? "application/octet-stream",
    sizeBytes: asset.size ?? 0,
  };
}
