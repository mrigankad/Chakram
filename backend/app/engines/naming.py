"""Names shared by the composer and the API kit."""
import re


def collection_name(entity: str) -> str:
    """'Appointment' -> 'appointments', 'Category' -> 'categories', 'Status' -> 'statuses'."""
    name = entity[0].lower() + entity[1:]
    if re.search(r"[^aeiou]y$", name):
        return name[:-1] + "ies"
    if name.endswith(("s", "x", "z", "ch", "sh")):
        return name + "es"
    return name + "s"
