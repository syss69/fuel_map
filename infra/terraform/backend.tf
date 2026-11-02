terraform {
  backend "s3" {
    bucket       = "trajetico-terraform-state"
    key          = "fuel-map/staging/terraform.tfstate"
    region       = "eu-north-1"
    profile      = "terraform"
    encrypt      = true
    use_lockfile = true
  }
}
