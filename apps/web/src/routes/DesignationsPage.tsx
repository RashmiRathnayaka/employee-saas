import { SimpleNamedEntityPage } from "../components/SimpleNamedEntityPage";
import { strings } from "../strings";

export function DesignationsPage() {
  return (
    <SimpleNamedEntityPage
      resourcePath="/designations"
      queryKey="designations"
      title={strings.designations.title}
      newLabel={strings.designations.newDesignation}
      noItemsLabel={strings.designations.noItems}
    />
  );
}
