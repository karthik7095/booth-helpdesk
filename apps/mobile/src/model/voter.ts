import { Model } from "@nozbe/watermelondb";

/**
 * Plain getters rather than WatermelonDB's `@field` decorators: the decorator
 * form (`@field('x') name!: number`) is a definite-assignment class field, and
 * Babel refuses to compile that — "Definitely assigned fields cannot be
 * initialized here". Getters over `_getRaw` are the same thing without the
 * transform, and they keep the project free of a decorators plugin.
 */
export default class VoterModel extends Model {
  static table = "voters";

  private str(column: string): string | null {
    const value = this._getRaw(column);

    return value === null || value === undefined ? null : String(value);
  }

  private num(column: string): number {
    return Number(this._getRaw(column) ?? 0);
  }

  get assemblyNo(): number {
    return this.num("assembly_no");
  }

  get partNo(): number {
    return this.num("part_no");
  }

  get srNo(): number {
    return this.num("sr_no");
  }

  get eFirstName(): string | null {
    return this.str("e_first_name");
  }

  get eMiddleName(): string | null {
    return this.str("e_middle_name");
  }

  get lFirstName(): string | null {
    return this.str("l_first_name");
  }

  get lMiddleName(): string | null {
    return this.str("l_middle_name");
  }

  get sex(): string | null {
    return this.str("sex");
  }

  get age(): number | null {
    const value = this._getRaw("age");

    return value === null || value === undefined ? null : Number(value);
  }

  get vcardId(): string | null {
    return this.str("vcard_id");
  }

  get houseNo(): string | null {
    return this.str("house_no");
  }

  get lAddress(): string | null {
    return this.str("l_address");
  }

  get eAssemblyName(): string | null {
    return this.str("e_assembly_name");
  }

  get eVillage(): string | null {
    return this.str("e_village");
  }

  get eBoothAddress(): string | null {
    return this.str("e_booth_address");
  }

  get mobileNo1(): string | null {
    return this.str("mobile_no1");
  }

  get sectionNo(): number | null {
    return this.num("section_no");
  }

  /** Gram panchayat rolls only. */
  get wardNo(): number | null {
    return this.num("ward_no");
  }

  get eLastName(): string | null {
    return this.str("e_last_name");
  }

  /** The roll's English name, kept once an agent has corrected it; null otherwise. */
  get eFirstNameRoll(): string | null {
    return this.str("e_first_name_roll");
  }

  get lLastName(): string | null {
    return this.str("l_last_name");
  }

  get relationType(): string | null {
    return this.str("relation_type");
  }

  get streetArea(): string | null {
    return this.str("street_area");
  }

  get religion(): string | null {
    return this.str("religion");
  }

  get community(): string | null {
    return this.str("community");
  }

  get caste(): string | null {
    return this.str("caste");
  }

  get subCategory(): string | null {
    return this.str("sub_category");
  }

  get partyLoyalty(): string | null {
    return this.str("party_loyalty");
  }

  get hasVoted(): boolean {
    return Boolean(this._getRaw("has_voted"));
  }

  get isNewEnrollment(): boolean {
    return Boolean(this._getRaw("is_new_enrollment"));
  }

  get isFound(): boolean {
    return Boolean(this._getRaw("is_found"));
  }

  get remark(): string | null {
    return this.str("remark");
  }

  get remarkDone(): boolean {
    return Boolean(this._getRaw("remark_done"));
  }

  get remarkBy(): string | null {
    return this.str("remark_by");
  }

  get remarkAt(): number | null {
    const value = this._getRaw("remark_at");

    return typeof value === "number" ? value : null;
  }

  get isDeceased(): boolean {
    return Boolean(this._getRaw("is_deceased"));
  }

  get deceasedBy(): string | null {
    return this.str("deceased_by");
  }

  get deceasedAt(): number | null {
    const value = this._getRaw("deceased_at");

    return typeof value === "number" ? value : null;
  }

  /** Field-by-field writes, used inside `database.write`. */
  set(column: string, value: string | number | boolean | null): void {
    this._setRaw(column, value);
  }
}
