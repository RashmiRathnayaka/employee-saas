import { Text } from "react-native";
import { Screen } from "../../components/ui/Screen";
import { strings } from "../../strings";

// Balances, request list, detail and apply form land in 1.6b.
export default function LeaveScreen() {
  return (
    <Screen>
      <Text>{strings.leave.title}</Text>
    </Screen>
  );
}
