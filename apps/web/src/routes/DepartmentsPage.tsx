import { SimpleNamedEntityPage } from "../components/SimpleNamedEntityPage";
import { strings } from "../strings";

export function DepartmentsPage() {
  return (
    <SimpleNamedEntityPage
      resourcePath="/departments"
      queryKey="departments"
      title={strings.departments.title}
      newLabel={strings.departments.newDepartment}
      noItemsLabel={strings.departments.noItems}
    />
  );
}
