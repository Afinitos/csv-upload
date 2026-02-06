import type { CsvSchema } from "./types";

export const defaultSchemas: CsvSchema[] = [
  {
    id: "empty_schema",
    name: "Empty schema",
    description: "Start with an empty list of expected columns.",
    columns: [],
  },
  {
    id: "customer_contacts",
    name: "Customer Contacts",
    description: "Contacts export with customer and company information.",
    columns: [
      { key: "index", label: "Index" },
      { key: "customerId", label: "Customer Id" },
      { key: "firstName", label: "First Name" },
      { key: "lastName", label: "Last Name" },
      { key: "company", label: "Company" },
      { key: "city", label: "City" },
      { key: "country", label: "Country" },
      { key: "phone1", label: "Phone 1" },
      { key: "phone2", label: "Phone 2" },
      { key: "email", label: "Email" },
      { key: "subscriptionDate", label: "Subscription Date" },
      { key: "website", label: "Website" },
    ],
  },
];
