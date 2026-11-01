import { Text } from "react-native";
import { Screen } from "../../components/ui/Screen";
import { strings } from "../../strings";

// Full profile view/edit lands in 1.6b.
export default function ProfileScreen() {
  return (
    <Screen>
      <Text>{strings.profile.title}</Text>
    </Screen>
  );
}
